"use server";

// Server Actions for the unified /promote/submit flow: create a private
// draft (DOI-sourced or manual), edit it, attach/remove media, publish.
// File BYTES never come through here: the browser uploads straight to
// Storage (components/promote/MediaUploader.tsx) and then calls
// recordShowcaseMediaAction with the object path, which is checked server
// side before a row is written.
//
// Goes through lib/server/showcase.ts -> lib/auth.ts. Never @supabase directly.

import { revalidatePath } from "next/cache";
import { UnauthorizedError } from "@/lib/auth";
import {
  createArticleEntry,
  deleteShowcaseEntry,
  EmptyArticleError,
  MediaRecordError,
  recordShowcaseMedia,
  removeShowcaseMedia,
  setArticlePublished,
  ShareFileError,
  shareFileItem,
  type ShareFilePaper,
  updateFileShare,
  updateArticleEntry,
  updateShowcaseMediaLabel,
} from "@/lib/server/showcase";
import type { ArticleDraftPatch, CreateArticleInput, ShowcaseMedia, ShowcaseType } from "@/lib/showcaseTypes";

export type SimpleActionResult = { ok: true } | { ok: false; error: string };
export type ArticleDraftResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; error: string };
export type PublishActionResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };
export type MediaActionResult =
  | { ok: true; media: ShowcaseMedia }
  | { ok: false; error: string };
export type MediaLabelResult =
  | { ok: true; label: string | null }
  | { ok: false; error: string };

/** Delete a showcase entry as the signed-in user. Rejects (401-equivalent)
 *  when signed out — the UI gate is a convenience, this is the actual
 *  enforcement. RLS is the real gate below that. */
export async function deleteShowcaseAction(entryId: string): Promise<SimpleActionResult> {
  if (!entryId) return { ok: false, error: "Missing entry." };

  try {
    await deleteShowcaseEntry(entryId);
    revalidatePath("/promote");
    revalidatePath("/files");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: "Sign in to delete this entry." };
    }
    console.error("deleteShowcaseAction failed", e);
    return { ok: false, error: "Couldn't delete the entry. Please try again." };
  }
}

// ── article draft: create / edit / publish ──────────────────────────────────
//
// The generator itself (/api/promote/generate) is public and stateless — it
// only fetches metadata and asks Groq to draft an article; it writes
// nothing. These actions are the signed-in step that turns that (or a
// manually-written article, if the author skipped the DOI) into a real
// promote_showcase row: create a private draft, let the author edit it,
// attach media, then publish. Nothing here is reachable signed out —
// UnauthorizedError from lib/server/showcase.ts (via requireCurrentUser) maps
// to a "sign in" message; RLS is the actual enforcement underneath.

// Only `title` is required here — NOT headline/articleBody. The DOI path
// always has real content for both by the time it calls this (the
// generated article), but the manual path creates its draft row LAZILY, on
// first input, blank (see SubmitFlow.tsx's ensureDraft) specifically so the
// Media uploader has a real showcase_id to attach to before the person has
// typed a headline or a word of body text. Blocking on headline/body here
// would defeat that. setArticlePublished's own check (EmptyArticleError) is
// what actually stops an empty draft from becoming a public article — this
// only guards against a genuinely malformed call.
export async function createArticleDraftAction(
  input: CreateArticleInput
): Promise<ArticleDraftResult> {
  if (!input?.title?.trim()) {
    return { ok: false, error: "A title is required." };
  }

  try {
    const { id, slug } = await createArticleEntry(input);
    return { ok: true, id, slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to save a draft." };
    console.error("createArticleDraftAction failed", e);
    return { ok: false, error: "Couldn't save the draft. Please try again." };
  }
}

export async function updateArticleDraftAction(
  entryId: string,
  patch: ArticleDraftPatch
): Promise<SimpleActionResult> {
  if (!entryId) return { ok: false, error: "Missing article." };

  try {
    await updateArticleEntry(entryId, patch);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit this draft." };
    console.error("updateArticleDraftAction failed", e);
    return { ok: false, error: "Couldn't save your edits. Please try again." };
  }
}

/** Toggle an article's visibility. `publish: true` makes it live at
 *  /promote/[slug]; `false` takes it back down to draft-only. Revalidates
 *  the gallery and the article's own path either way so a stale cached
 *  render never outlives the flag.
 *
 *  Returns the article's FINAL slug — setArticlePublished may have just
 *  regenerated it from a placeholder-derived slug to a real one (see that
 *  function's own comment), so the caller (ArticleEditor.tsx) can update
 *  its own "View"/share links, and revalidate the NEW path too, in case
 *  the old one changed under it. */
export async function setArticlePublishedAction(
  entryId: string,
  slug: string,
  publish: boolean
): Promise<PublishActionResult> {
  if (!entryId || !slug) return { ok: false, error: "Missing article." };

  try {
    const result = await setArticlePublished(entryId, publish);
    revalidatePath("/promote");
    revalidatePath("/files");
    for (const s of new Set([slug, result.slug])) {
      revalidatePath(`/promote/${s}`);
      revalidatePath(`/files/${s}`);
    }
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return { ok: false, error: publish ? "Sign in to publish." : "Sign in to unpublish." };
    }
    if (e instanceof EmptyArticleError) {
      return { ok: false, error: e.message };
    }
    console.error("setArticlePublishedAction failed", e);
    return { ok: false, error: "Couldn't update the article. Please try again." };
  }
}

// ── "Share a file" (/share) ─────────────────────────────────────────

/** Publish a "Share a file" item straight away. `confirmed` is the screen's
 *  required tick box ("no patient or private data, and I have the right to
 *  share it"); it is checked again here so a direct call can't skip it. */
export async function shareFileAction(input: {
  id: string;
  type: ShowcaseType;
  title: string;
  paper: ShareFilePaper | null;
  confirmed: boolean;
}): Promise<PublishActionResult> {
  if (!input?.id) return { ok: false, error: "Add a file first." };
  if (input.confirmed !== true) {
    return { ok: false, error: "Tick the box to confirm you can share this file." };
  }

  try {
    const { slug } = await shareFileItem({
      id: input.id,
      type: input.type,
      title: typeof input.title === "string" ? input.title : "",
      paper: input.paper ?? null,
    });
    revalidatePath("/files");
    revalidatePath(`/files/${slug}`);
    return { ok: true, slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to share." };
    if (e instanceof ShareFileError) return { ok: false, error: e.message };
    if (e instanceof EmptyArticleError) return { ok: false, error: "Add a file first." };
    console.error("shareFileAction failed", e);
    return { ok: false, error: "Couldn't share this file. Please try again." };
  }
}

// ── "Manage file" (/files/<slug>/edit) ──────────────────────────────────────

/** "Save changes": the title, type and paper of a file page. */
export async function updateFileShareAction(input: {
  id: string;
  type: ShowcaseType;
  title: string;
  paper: ShareFilePaper | null;
}): Promise<SimpleActionResult> {
  if (!input?.id) return { ok: false, error: "This file page could not be found." };
  try {
    await updateFileShare({
      id: input.id,
      type: input.type,
      title: typeof input.title === "string" ? input.title : "",
      paper: input.paper ?? null,
    });
    revalidatePath("/files");
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to save changes." };
    if (e instanceof ShareFileError) return { ok: false, error: e.message };
    console.error("updateFileShareAction failed", e);
    return { ok: false, error: "Couldn't save your changes. Please try again." };
  }
}

/** "Make public" / "Hide" for a file page. Making it public needs a title
 *  and at least one file (the same rule as sharing it). */
export async function setFileSharePublicAction(
  id: string,
  slug: string,
  makePublic: boolean
): Promise<PublishActionResult> {
  if (!id || !slug) return { ok: false, error: "This file page could not be found." };
  try {
    const result = await setArticlePublished(id, makePublic);
    revalidatePath("/files");
    for (const s of new Set([slug, result.slug])) revalidatePath(`/files/${s}`);
    return { ok: true, slug: result.slug };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to change this." };
    if (e instanceof EmptyArticleError) return { ok: false, error: "Add a title and at least one file first." };
    console.error("setFileSharePublicAction failed", e);
    return { ok: false, error: "Couldn't change this. Please try again." };
  }
}

// ── media attachments ────────────────────────────────────────────────────────

/** Record a file the browser has already uploaded to Storage. Only the path
 *  and the original filename come from the browser; recordShowcaseMedia
 *  checks the path is in this item's folder, that the caller owns the item
 *  and that the object exists, and takes the size from Storage. */
export async function recordShowcaseMediaAction(input: {
  showcaseId: string;
  path: string;
  filename: string;
}): Promise<MediaActionResult> {
  const showcaseId = typeof input?.showcaseId === "string" ? input.showcaseId : "";
  const path = typeof input?.path === "string" ? input.path : "";
  const filename = typeof input?.filename === "string" ? input.filename : "";
  if (!showcaseId || !path) return { ok: false, error: "Missing upload." };

  try {
    const media = await recordShowcaseMedia({ showcaseId, path, filename });
    return { ok: true, media };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to attach files." };
    if (e instanceof MediaRecordError) return { ok: false, error: e.message };
    console.error("recordShowcaseMediaAction failed", e);
    return { ok: false, error: "Couldn't attach that file. Please try again." };
  }
}

/** Set or clear the one-line label of an attached file. */
export async function updateShowcaseMediaLabelAction(
  showcaseId: string,
  mediaId: string,
  label: string
): Promise<MediaLabelResult> {
  if (!showcaseId || !mediaId) return { ok: false, error: "Missing attachment." };
  try {
    const saved = await updateShowcaseMediaLabel(showcaseId, mediaId, typeof label === "string" ? label : "");
    return { ok: true, label: saved };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to edit labels." };
    if (e instanceof MediaRecordError) return { ok: false, error: e.message };
    console.error("updateShowcaseMediaLabelAction failed", e);
    return { ok: false, error: "Couldn't save the label. Please try again." };
  }
}

export async function removeShowcaseMediaAction(
  showcaseId: string,
  mediaId: string
): Promise<SimpleActionResult> {
  if (!showcaseId || !mediaId) return { ok: false, error: "Missing attachment." };

  try {
    await removeShowcaseMedia(showcaseId, mediaId);
    return { ok: true };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in to remove files." };
    if (e instanceof MediaRecordError) return { ok: false, error: e.message };
    console.error("removeShowcaseMediaAction failed", e);
    return { ok: false, error: "Couldn't remove that file. Please try again." };
  }
}
