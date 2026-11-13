// lib/server/showcase.ts — the Promote showcase gallery + the unified
// /promote/submit article flow (paste a DOI, generate, edit, attach media,
// publish — or go manual and skip generation, same downstream steps).
//
// Follows lib/server/collab.ts exactly: reads go through the request-scoped
// client (public-select RLS covers signed-out browsing), writes go through
// requireCurrentUser() so owner_id comes from the validated session and never
// from a request body. RLS enforces the same rule in Postgres.
//
// AUTH: everything here goes through lib/auth.ts and never imports @supabase
// directly — see the SWAP POINT comment there.
//
// PRIVACY: owner identity is read via the showcase_owners() SECURITY DEFINER
// function, NOT a join on public.users. That table's RLS only exposes fully
// public profiles, so a plain join would render a private-profile submitter's
// card anonymous. The function returns name + affiliation only — never email.

import {
  getCurrentUser,
  getDb,
  requireCurrentUser,
  ServerConfigError,
  type Db,
} from "@/lib/auth";
import { getAnonServerClient } from "@/lib/server/supabaseServer";
import { cleanPaperYear } from "@/lib/server/promote/quickShare";
import { canRemoveFile } from "@/lib/server/promote/manageFile";
import {
  MAX_MEDIA_BYTES,
  cleanMediaLabel,
  displayFileName,
  formatFileSize,
  isMediaObjectPathFor,
  isUuid,
  mediaKindFor,
} from "@/lib/server/promote/mediaFiles";
import type { ArticleEditorEntry } from "@/components/promote/ArticleEditor";
import { SITE_URL } from "@/lib/articleFormat";
import {
  itemUrlFor,
  linkedPaperTitle,
  listedInRecentlyShared,
  listedInYourFiles,
  listedOnPromote,
} from "@/lib/server/promote/itemAddress";
import {
  canonicalType,
  factsForRow,
  firstLinkIn,
  matchesType,
  normalizeKeyFacts,
  resolveCta,
  safeHttpUrl,
  type KeyFact,
} from "@/lib/server/promote/showcaseKinds";
import {
  draftShareTexts,
  normalizeShareTexts,
  shareTextsEmpty,
  type ShareTexts,
} from "@/lib/server/promote/shareText";
import {
  SHOWCASE_TYPE_LABEL,
  SHOWCASE_TYPES,
  type ArticleDraftPatch,
  type CreateArticleInput,
  type MediaKind,
  type PublicArticle,
  type ShowcaseCommunity,
  type ShowcaseEntry,
  type ShowcaseMedia,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

export {
  SHOWCASE_TYPES,
  SHOWCASE_TYPE_LABEL,
  type ShowcaseEntry,
  type ShowcaseOwner,
  type ShowcaseType,
} from "@/lib/showcaseTypes";

// `community:communities(id, slug, name)` — an embedded read through the
// FK, not a second query. communities' own SELECT policy is USING (true)
// (see database/migrations/2026-08-20_communities.sql), so this is safe to
// embed even for the anon-client reads below (getPublishedArticleBySlug):
// nothing here can expose a community a plain unauthenticated visitor
// couldn't already look up directly. NULL community_id -> NULL here, same
// as any other to-one embed with no matching row.
const ENTRY_SELECT =
  "id, type, title, headline, standfirst, article_body, slug, description, authors, link, image_url, journal, doi, tags, created_at, published_at, owner_id, community_id, key_facts, cta_label, cta_url, event_starts_at, event_location, featured";

/** Pull the embedded `community:communities(...)` object (see ENTRY_SELECT's
 *  own comment) into a ShowcaseCommunity, or null. Supabase can return this
 *  as an object OR (depending on how it infers the relationship) a
 *  single-element array — handled here once rather than in every caller. */
function toCommunity(row: Record<string, unknown>): ShowcaseCommunity | null {
  const raw = row.community;
  const c = Array.isArray(raw) ? raw[0] : raw;
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  if (!obj.id) return null;
  return {
    id: obj.id as string,
    slug: (obj.slug as string | null) ?? null,
    name: obj.name as string,
    kind: obj.kind === "team" ? "team" : "community",
  };
}

/** Fills `row.community` for each row from community_labels(). Teams are not
 *  public rows, so the name comes from that SECURITY DEFINER function: anyone
 *  gets a team's NAME, but the slug (the way into a team) only comes back for a
 *  community, or for the team's own members. A failed lookup leaves no label. */
async function attachCommunities(rows: Record<string, unknown>[]): Promise<void> {
  const ids = [...new Set(rows.map((r) => r.community_id as string | null).filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const { data, error } = await db.rpc("community_labels", { p_ids: ids });
  if (error || !Array.isArray(data)) return;
  const byId = new Map((data as { id: string; name: string; slug: string | null; kind: string }[]).map((l) => [l.id, l]));
  for (const r of rows) {
    const l = byId.get(r.community_id as string);
    r.community = l ? { id: l.id, slug: l.slug, name: l.name, kind: l.kind } : null;
  }
}

function toEntry(
  row: Record<string, unknown>,
  owners: Map<string, ShowcaseOwner>,
  viewerId: string | null,
  heroImages: Map<string, string>
): ShowcaseEntry {
  const type = canonicalType(row.type as string | null);
  return {
    id: row.id as string,
    type,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    authors: (row.authors as string) ?? "",
    link: (row.link as string) ?? null,
    image_url: (row.image_url as string) ?? null,
    journal: (row.journal as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    created_at: row.created_at as string,
    owner: owners.get(row.owner_id as string) ?? null,
    // Computed here, once, from the session — NOT shipped as owner_id. The
    // client gets a yes/no per entry, never the id it'd be compared against.
    is_owner: viewerId !== null && row.owner_id === viewerId,
    slug: (row.slug as string) || null,
    headline: (row.headline as string) || "",
    standfirst: (row.standfirst as string) ?? "",
    articleBody: (row.article_body as string) ?? "",
    publishedAt: (row.published_at as string | null) ?? null,
    community: toCommunity(row),
    // Attached media wins over the legacy column — see the field's own
    // comment in showcaseTypes.ts for why this can't be re-derived client-side.
    heroImageUrl: heroImages.get(row.id as string) ?? (row.image_url as string | null) ?? null,
    keyFacts: factsForRow(type, row.key_facts), // stored facts only; none = no strip
    cta: resolveCta(type, {
      ctaLabel: row.cta_label as string | null,
      ctaUrl: row.cta_url as string | null,
      link: row.link as string | null,
      doi: row.doi as string | null,
    }, firstLinkIn(row.article_body as string)),
    eventStartsAt: (row.event_starts_at as string | null) ?? null,
    eventLocation: (row.event_location as string | null) ?? null,
    featured: Boolean(row.featured),
  };
}

/** owner_id -> public identity (name + affiliation). Degrades to an empty map so
 *  an owner-lookup failure leaves cards uncredited rather than blanking the
 *  gallery. */
async function ownerMap(db: Db): Promise<Map<string, ShowcaseOwner>> {
  const { data, error } = await db.rpc("showcase_owners");
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as ShowcaseOwner[]).map((o) => [o.id, o]));
}

/** showcase_id -> a freshly SIGNED URL for that entry's first attached
 *  `image`-kind media (earliest by created_at), for the gallery card. Signed
 *  URLs expire (10 minutes — SIGNED_URL_TTL_SECONDS below), so this must be
 *  called on every request that renders the gallery, same as the article
 *  page's own heroImage() — never cached/stored, and listShowcase's caller
 *  (app/promote/page.tsx) is already `force-dynamic` for exactly this reason.
 *
 *  One query for every entry's candidate images, not one query per entry:
 *  a gallery page rendering N cards would otherwise be N+1 round trips to
 *  find just the first image each. Grouping/picking "first per showcase_id"
 *  happens here in JS rather than in SQL (no DISTINCT ON via supabase-js)
 *  since a gallery page is at most a few dozen rows — cheap either way. */
async function getShowcaseHeroImages(
  db: Db,
  showcaseIds: string[]
): Promise<Map<string, string>> {
  if (showcaseIds.length === 0) return new Map();

  const { data, error } = await db
    .from("promote_showcase_media")
    .select("showcase_id, url, created_at")
    .in("showcase_id", showcaseIds)
    .eq("kind", "image")
    .order("created_at", { ascending: true });
  if (error || !data) return new Map();

  const firstPathByEntry = new Map<string, string>();
  for (const row of data as Record<string, unknown>[]) {
    const id = row.showcase_id as string;
    if (!firstPathByEntry.has(id)) firstPathByEntry.set(id, row.url as string);
  }

  const signed = new Map<string, string>();
  await Promise.all(
    Array.from(firstPathByEntry.entries()).map(async ([id, path]) => {
      try {
        signed.set(id, await signMediaPath(db, path));
      } catch {
        // Unsignable/orphaned path — the card falls back to image_url (or
        // the placeholder), same degrade listShowcaseMedia uses per-row.
      }
    })
  );
  return signed;
}

// ── reads (public) ───────────────────────────────────────────────────────────
//
// The gallery only ever shows PUBLISHED rows — a draft-in-progress from the
// unified submit flow must not appear here before its author publishes it.
// promote_showcase_select_published RLS would already exclude another
// owner's draft, but a signed-in AUTHOR reading their OWN draft would still
// pass promote_showcase_select_own — the explicit .eq("published", true)
// below is what keeps the gallery itself showing only finished entries even
// to the person who's still editing one.

/** Browse the showcase. Public — no session required. */
export async function listShowcase(
  opts: { type?: ShowcaseType | "all" } = {}
): Promise<ShowcaseEntry[]> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  // The type filter is applied here, on the mapped type, so an older row (an
  // "award") still shows under its current chip ("Achievement").
  // File shares (/files) are never in the Promote feed. Before the
  // is_file_share column exists there are none to leave out.
  const { data, error } = await withOptionalColumns(["is_file_share"], (present) => {
    let q = db
      .from("promote_showcase")
      .select(present.length ? `${ENTRY_SELECT}, is_file_share` : ENTRY_SELECT)
      .eq("published", true);
    if (present.length) q = q.eq("is_file_share", false);
    return q.order("created_at", { ascending: false });
  });
  if (error || !data) return [];

  const rows = (data as unknown as Record<string, unknown>[]).filter(
    (r) =>
      listedOnPromote({ published: true, is_file_share: r.is_file_share as boolean | undefined }) &&
      matchesType(r.type as string | null, opts.type ?? "all")
  );
  await attachCommunities(rows);
  const viewer = await getCurrentUser();
  const [owners, heroImages] = await Promise.all([
    ownerMap(db),
    getShowcaseHeroImages(db, rows.map((r) => r.id as string)),
  ]);
  return rows.map((r) => toEntry(r, owners, viewer?.id ?? null, heroImages));
}

/** A community's own Showcase section (app/communities/[slug]/page.tsx) —
 *  PUBLISHED articles attached to this community, newest first. Public, same
 *  as listShowcase: a published article stays publicly readable whether or
 *  not it has a community (promote_showcase_select_published), so this never
 *  gates on membership — an unpublished draft never reaches this query
 *  regardless of who the viewer is, the same .eq("published", true) guard
 *  listShowcase itself relies on rather than trusting RLS alone to filter
 *  drafts out of a page meant to show only finished work. */
export async function listShowcaseByCommunity(communityId: string): Promise<ShowcaseEntry[]> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .eq("published", true)
    .eq("community_id", communityId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const rows = data as Record<string, unknown>[];
  await attachCommunities(rows);
  const viewer = await getCurrentUser();
  const [owners, heroImages] = await Promise.all([
    ownerMap(db),
    getShowcaseHeroImages(db, rows.map((r) => r.id as string)),
  ]);
  return rows.map((r) => toEntry(r, owners, viewer?.id ?? null, heroImages));
}

/** One PUBLISHED showcase entry. Null when it doesn't exist or isn't
 *  published. Currently unused by any route (the gallery links straight to
 *  /promote/[slug] for anything that has one) but kept for a future
 *  id-based lookup; scoped to published for the same reason listShowcase is. */
export async function getShowcaseEntry(id: string): Promise<ShowcaseEntry | null> {
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select(ENTRY_SELECT)
    .eq("id", id)
    .eq("published", true)
    .maybeSingle();

  if (error || !data) return null;
  await attachCommunities([data as Record<string, unknown>]);
  const viewer = await getCurrentUser();
  const [owners, heroImages] = await Promise.all([
    ownerMap(db),
    getShowcaseHeroImages(db, [data.id as string]),
  ]);
  return toEntry(data as Record<string, unknown>, owners, viewer?.id ?? null, heroImages);
}

// ── article draft (create/edit/publish) ─────────────────────────────────────
//
// A row here starts life PRIVATE (published defaults to false) and gets a
// `slug` so it has a page at /promote/[slug] once published. The generator
// route itself (/api/promote/generate) writes nothing; these functions are
// what app/promote/actions.ts calls for every entry now, DOI-sourced or
// manual alike — there is only one creation path since the submit-flow
// merge, not a separate "generated article" vs. "manual showcase entry".

/** "Some Title, With Punctuation!" -> "some-title-with-punctuation". Falls
 *  back to "article" if the title has no latin/digit characters left after
 *  stripping (e.g. an all-symbols or non-latin title). */
function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "article";
}

/** Short random suffix appended on a slug collision — not meant to be
 *  memorable, just enough entropy that a second retry essentially never
 *  collides again. */
function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 7);
}

/** Create a new article draft as the signed-in user. owner_id comes from the
 *  session, published starts false (the column default), and the slug is
 *  derived from the title with a short random suffix appended on collision —
 *  retried a few times against the unique index (idx_promote_showcase_slug)
 *  rather than pre-checking existence, which would be a race under
 *  concurrent submissions of the same title. */
export async function createArticleEntry(
  input: CreateArticleInput
): Promise<{ id: string; slug: string }> {
  const { user, db } = await requireCurrentUser();
  const base = slugifyTitle(input.title || input.headline);

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;

    const { data, error } = await db
      .from("promote_showcase")
      .insert({
        owner_id: user.id, // from the session, never the body
        type: input.type,
        title: input.title,
        headline: input.headline,
        standfirst: input.standfirst,
        article_body: input.articleBody,
        authors: input.authors ?? "",
        doi: input.doi ?? null,
        link: input.link ?? null,
        journal: input.journal ?? null,
        linkedin_post: input.linkedinPost ?? "",
        // NULL (no community) unless the caller passed one — enforced
        // server-side beyond just the picker only offering communities the
        // author actually belongs to: promote_showcase_insert_own's WITH
        // CHECK (can_post_to_community) rejects a forged id outright, same
        // as owner_id is already enforced by RLS rather than trusted here.
        community_id: input.communityId ?? null,
        key_facts: sanitizeFacts(input.keyFacts),
        share_text: input.shareText ?? {},
        slug,
        // published intentionally omitted -> column default (false): a
        // freshly created draft is private until publishArticle().
      })
      .select("id, slug")
      .single();

    if (!error && data) {
      // A draft that already has a headline (the DOI path) gets its share
      // drafts straight away.
      if (input.headline.trim()) await ensureShareText(data.id as string);
      return { id: data.id as string, slug: data.slug as string };
    }
    // 23505 = unique_violation. Only the slug index can collide here (id is a
    // fresh gen_random_uuid()) — retry with a new suffix rather than failing
    // the whole submission over a title someone already used.
    if (error?.code !== "23505") throw error ?? new Error("Insert returned no row.");
  }
  throw new Error("Couldn't generate a unique link for this article. Please try again.");
}

/** Edit a draft (or a published article) as its owner. Only the fields
 *  present in `patch` are touched. The .eq("owner_id", user.id) here is
 *  belt-and-suspenders — the real gate is promote_showcase_update_own RLS. */
export async function updateArticleEntry(id: string, patch: ArticleDraftPatch): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const update: Record<string, unknown> = {};
  if (patch.type !== undefined) update.type = patch.type;
  if (patch.headline !== undefined) update.headline = patch.headline;
  if (patch.standfirst !== undefined) update.standfirst = patch.standfirst;
  if (patch.articleBody !== undefined) update.article_body = patch.articleBody;
  if (patch.authors !== undefined) update.authors = patch.authors;
  if (patch.linkedinPost !== undefined) update.linkedin_post = patch.linkedinPost;
  if (patch.communityId !== undefined) update.community_id = patch.communityId;
  if (patch.doi !== undefined) update.doi = patch.doi;
  if (patch.link !== undefined) update.link = patch.link;
  if (patch.journal !== undefined) update.journal = patch.journal;
  if (patch.keyFacts !== undefined) update.key_facts = sanitizeFacts(patch.keyFacts);
  if (patch.ctaLabel !== undefined) update.cta_label = (patch.ctaLabel ?? "").trim().slice(0, 40) || null;
  if (patch.ctaUrl !== undefined) update.cta_url = safeHttpUrl(patch.ctaUrl);
  if (patch.quote !== undefined) update.quote = (patch.quote ?? "").trim().slice(0, 600) || null;
  if (patch.quoteBy !== undefined) update.quote_by = (patch.quoteBy ?? "").trim().slice(0, 120) || null;
  if (patch.eventStartsAt !== undefined) update.event_starts_at = validIso(patch.eventStartsAt);
  if (patch.eventLocation !== undefined) update.event_location = (patch.eventLocation ?? "").trim().slice(0, 200) || null;
  if (patch.shareText !== undefined) {
    const t = normalizeShareTexts(patch.shareText);
    update.share_text = t;
    // The LinkedIn column stays in step: older readers use it.
    update.linkedin_post = t.linkedin;
  }
  // Only a site admin's value sticks: the database trigger resets anyone
  // else's, this just avoids sending it.
  if (patch.featured !== undefined && (await isSiteAdmin())) update.featured = patch.featured;
  if (Object.keys(update).length === 0) return;

  const { error } = await db
    .from("promote_showcase")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw error;

  // Share drafts are written once the item has a headline, unless the author
  // already has some (never overwritten).
  if (patch.headline !== undefined || patch.standfirst !== undefined || patch.articleBody !== undefined) {
    await ensureShareText(id);
  }
}

/** Three facts at most, each a trimmed label and value. */
function sanitizeFacts(facts: KeyFact[] | undefined): KeyFact[] {
  if (!Array.isArray(facts)) return [];
  const cleaned = facts.slice(0, 3).map((f) => ({
    label: String(f?.label ?? "").trim().slice(0, 60),
    value: String(f?.value ?? "").trim().slice(0, 200),
  }));
  // All blank = nothing stored, so the item shows no fact strip.
  return cleaned.some((f) => f.value) ? cleaned : [];
}

function validIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Is the signed-in user a site admin? (public.site_admins, read through RLS
 *  as their own row.) Signed out or any failure: false. */
export async function isSiteAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const db = await getDb();
  if (!db) return false;
  const { data, error } = await db.rpc("is_site_admin");
  return !error && data === true;
}

/** Fill in the three share drafts for an item when it has none yet. The
 *  author's existing LinkedIn post (the older column) is kept as the LinkedIn
 *  text when there is one. Best-effort: a failure leaves the drafts empty and
 *  the editor offers to generate them. */
async function ensureShareText(id: string): Promise<void> {
  try {
    const { user, db } = await requireCurrentUser();
    const { data: row } = await withOptionalColumns(["is_file_share"], (present) =>
      db
        .from("promote_showcase")
        .select(
          ["type, headline, standfirst, article_body, tags, key_facts, linkedin_post, share_text, slug", ...present].join(", ")
        )
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle()
    );
    const data = row as unknown as Record<string, unknown> | null;
    if (!data || !(data.headline as string)?.trim()) return;
    const current = normalizeShareTexts(data.share_text);
    if (current.linkedin.trim() && current.x.trim() && current.bluesky.trim()) return;
    const type = canonicalType(data.type as string);
    const draft = draftShareTexts({
      type,
      headline: data.headline as string,
      standfirst: (data.standfirst as string) ?? "",
      facts: factsForRow(type, data.key_facts),
      tags: (data.tags as string[]) ?? [],
      url: itemUrlFor(SITE_URL, data.slug as string, data.is_file_share === true),
    });
    const next: ShareTexts = {
      linkedin: current.linkedin.trim() || ((data.linkedin_post as string) ?? "").trim() || draft.linkedin,
      x: current.x.trim() || draft.x,
      bluesky: current.bluesky.trim() || draft.bluesky,
    };
    if (shareTextsEmpty(next)) return;
    await db
      .from("promote_showcase")
      .update({ share_text: next, linkedin_post: next.linkedin })
      .eq("id", id)
      .eq("owner_id", user.id);
  } catch (e) {
    console.error("ensureShareText failed", e);
  }
}

/** True when `title` is exactly the placeholder ensureDraft() (SubmitFlow.tsx)
 *  writes before a headline exists — SHOWCASE_TYPE_LABEL[type], e.g.
 *  "Conference or talk" or "Tool or software". A row created this way never
 *  gets `title` touched again (updateArticleEntry's patch has no `title`
 *  field — only `headline` changes as generation/editing happens), so the
 *  slug createArticleEntry derived from that placeholder at creation time
 *  sticks around forever unless something notices and fixes it. */
function looksLikePlaceholderTitle(title: string, type: ShowcaseType): boolean {
  return title === SHOWCASE_TYPE_LABEL[type];
}

/** Re-slug (and re-title) a draft whose slug still derives from the
 *  ensureDraft() placeholder rather than its real headline — e.g.
 *  /promote/conference-or-talk-r3f91 instead of a slug that means
 *  anything. Same collision-retry shape as createArticleEntry, but as an
 *  UPDATE: a 23505 here means the new slug collides with a DIFFERENT row,
 *  not this one (this row's OWN current slug is simply being replaced).
 *  Best-effort — if every attempt collides (astronomically unlikely for a
 *  headline-derived slug), the placeholder slug is left in place rather
 *  than blocking the publish over it. */
async function regenerateSlugFromHeadline(
  db: Db,
  id: string,
  userId: string,
  headline: string,
  title: string = headline
): Promise<string | null> {
  const base = slugifyTitle(headline);
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;
    const { error } = await db
      .from("promote_showcase")
      .update({ title, slug })
      .eq("id", id)
      .eq("owner_id", userId);
    if (!error) return slug;
    if (error.code !== "23505") throw error;
  }
  return null; // every attempt collided — leave the existing (placeholder) slug
}

/** Thrown by setArticlePublished when a draft has no headline/body yet.
 *  ArticleEditor already disables its Publish button for this case — this
 *  is the server-side half of that guard, since createArticleDraftAction
 *  deliberately allows creating a blank draft (see its own comment) so the
 *  Media uploader has a row to attach to before any text is written. An
 *  empty draft becoming a public article is a content-quality bug, not an
 *  access-control one, but it's still not something a direct call to this
 *  action should be able to do just because the UI wouldn't let you click
 *  the button. */
export class EmptyArticleError extends Error {
  constructor(message = "Add a headline and body before publishing.") {
    super(message);
    this.name = "EmptyArticleError";
  }
}

/** True when the item has at least one attached file (any kind). */
async function hasAttachedFile(db: Db, showcaseId: string): Promise<boolean> {
  const { data } = await db
    .from("promote_showcase_media")
    .select("id")
    .eq("showcase_id", showcaseId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Flip published on/off as the owner. Nothing is public until this has been
 *  called with `true` — see promote_showcase_select_published in RLS, which
 *  is the actual enforcement; this update just flips the flag it reads.
 *
 *  Publishing also stamps `published_at` to now() — this is what the
 *  article page's date line reads, not `created_at` (when the draft was
 *  started). Unpublishing leaves it as-is rather than clearing it, so
 *  re-publishing later reflects the most recent publish, not a fresh
 *  "first ever" date; that's an acceptable simplification for now.
 *
 *  FIRST PUBLISH ALSO REGENERATES A PLACEHOLDER SLUG. Every draft is
 *  created before a headline exists (SubmitFlow.tsx's ensureDraft — DOI
 *  path and structured-form path alike), so createArticleEntry has nothing
 *  to slug from yet but SHOWCASE_TYPE_LABEL[type] ("Conference or talk",
 *  "Tool or software"...). By the time this function runs, a real headline
 *  is guaranteed to exist (the hasContent check just below throws
 *  otherwise) — this is the first moment it's safe to re-slug from it. Only
 *  fires while `title` still equals that placeholder verbatim: once it's
 *  been regenerated, `title` no longer matches, so a later unpublish/
 *  republish cycle leaves the (by-now shared) slug alone.
 *
 *  Returns the FINAL slug (regenerated or, in every other case, unchanged)
 *  — the caller (setArticlePublishedAction) needs it to revalidate the
 *  right path and hand the new slug back to the editor, since a slug that
 *  changed out from under it would otherwise leave "View" and the share
 *  link pointing at a page that no longer exists. */
export async function setArticlePublished(id: string, published: boolean): Promise<{ slug: string }> {
  const { user, db } = await requireCurrentUser();

  const { data } = await db
    .from("promote_showcase")
    .select("headline, article_body, title, type, slug")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();

  let slug = (data?.slug as string | undefined) ?? "";

  if (published) {
    const headline = (data?.headline as string | undefined)?.trim() ?? "";
    const hasBody = Boolean((data?.article_body as string | undefined)?.trim());
    // A body is not needed when the item carries at least one file: that is
    // a download page ("Share a file", /share), not an article.
    const hasContent = Boolean(headline && (hasBody || (await hasAttachedFile(db, id))));
    if (!hasContent) throw new EmptyArticleError();

    const title = (data?.title as string | undefined) ?? "";
    const type = data?.type as ShowcaseType | undefined;
    if (type && looksLikePlaceholderTitle(title, type)) {
      const newSlug = await regenerateSlugFromHeadline(db, id, user.id, headline);
      if (newSlug) slug = newSlug;
    }
  }

  const { error } = await db
    .from("promote_showcase")
    .update(published ? { published, published_at: new Date().toISOString() } : { published })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw error;

  if (published) await ensureShareText(id);

  return { slug };
}

/** Delete a showcase entry as the signed-in user. Hard delete — same idiom as
 *  lib/server/collab.ts:deleteCollabPost (session-derived user, .delete().eq()).
 *
 *  The .eq("owner_id", user.id) here is belt-and-suspenders — the REAL gate
 *  is the promote_showcase_delete_own RLS policy, which enforces
 *  auth.uid() = owner_id in Postgres regardless of what this query claims.
 *
 *  promote_showcase_media rows cascade automatically (ON DELETE CASCADE on
 *  showcase_id) but their storage objects are a separate lifecycle from the
 *  Postgres row, so this fetches their paths FIRST and removes them from
 *  showcase-media after the row delete succeeds — mirroring the single-image
 *  cleanup this function used to do for image_url, just for N files instead
 *  of one. Best-effort: a storage cleanup failure only logs, since the
 *  primary action (removing the entry) already succeeded and failing the
 *  whole delete over an orphaned file would be worse. */
export async function deleteShowcaseEntry(entryId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  const { data: mediaRows } = await db
    .from("promote_showcase_media")
    .select("url")
    .eq("showcase_id", entryId)
    .eq("owner_id", user.id);

  const { data, error } = await db
    .from("promote_showcase")
    .delete()
    .eq("id", entryId)
    .eq("owner_id", user.id)
    .select("image_url")
    .maybeSingle();

  if (error) throw error;

  const mediaPaths = (mediaRows ?? [])
    .map((r: Record<string, unknown>) => r.url as string)
    .filter(Boolean);
  if (mediaPaths.length > 0) {
    const { error: mediaCleanupError } = await db.storage
      .from(SHOWCASE_MEDIA_BUCKET)
      .remove(mediaPaths);
    if (mediaCleanupError) {
      console.error("showcase media cleanup failed", mediaCleanupError, mediaPaths);
    }
  }

  // Legacy image_url cleanup (pre-media-table rows created via the old
  // manual submit form, which used the public showcase-images bucket).
  const imageUrl = (data?.image_url as string | null) ?? null;
  if (imageUrl) {
    const marker = "/object/public/showcase-images/";
    const i = imageUrl.indexOf(marker);
    const path = i === -1 ? null : imageUrl.slice(i + marker.length);
    if (path) {
      const { error: imgErr } = await db.storage.from("showcase-images").remove([path]);
      if (imgErr) console.error("legacy showcase image cleanup failed", imgErr, path);
    }
  }
}

// ── "Share a file" (/share) ─────────────────────────────────────────

/** Thrown by shareFileItem for input it refuses. The message is safe to show. */
export class ShareFileError extends Error {}

const SHARE_ITEM_TYPES: readonly ShowcaseType[] = ["dataset", "talk", "tool", "other"];

export type ShareFilePaper = {
  title: string;
  authors: string[];
  journal: string | null;
  doi: string | null;
  link: string | null;
  /** Year the paper was published; optional. */
  year?: number | null;
};

/** Publish a "Share a file" item in one step, as its owner. The headline is
 *  the title the person typed. With a paper, the item's `title` column holds
 *  the paper's title (as on the DOI path) and doi / journal / authors / link
 *  hold the rest; without one, `title` is the headline and those stay empty.
 *  The slug is rebuilt from the headline the first time the item goes live
 *  (the draft's slug came from the filename). Publishing itself goes through
 *  setArticlePublished, so the same rule applies: a headline and either a
 *  body or at least one file. No AI step anywhere. */
/** Write a file share's title, type and paper as its owner. Used by sharing
 *  (shareFileItem) and by "Save changes" on the Manage screen
 *  (updateFileShare). Only sharing marks the item as a file share. */
async function saveFileShareFields(
  db: Db,
  userId: string,
  input: { id: string; type: ShowcaseType; title: string; paper: ShareFilePaper | null },
  markAsFileShare: boolean
): Promise<{ published: boolean; headline: string; title: string }> {
  const headline = (input.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!headline) throw new ShareFileError("Add a title.");
  if (!SHARE_ITEM_TYPES.includes(input.type)) throw new ShareFileError("Choose what kind of file this is.");

  const { data: row } = await db
    .from("promote_showcase")
    .select("id, published")
    .eq("id", input.id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!row) throw new ShareFileError("This file page could not be found.");

  const p = input.paper;
  const paperTitle = (p?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  const doi = (p?.doi ?? "").trim().slice(0, 200) || null;
  const link = safeHttpUrl(p?.link ?? "") ?? (doi ? `https://doi.org/${doi}` : null);
  const hasPaper = Boolean(paperTitle && (doi || link));
  const title = hasPaper ? paperTitle : headline;

  const fields: Record<string, unknown> = {
    type: input.type,
    headline,
    title,
    authors: hasPaper
      ? (p?.authors ?? []).map((a) => String(a).trim()).filter(Boolean).join(", ").slice(0, 2000)
      : "",
    doi: hasPaper ? doi : null,
    link: hasPaper ? link : null,
    journal: hasPaper ? (p?.journal ?? "").trim().slice(0, 300) || null : null,
    paper_year: hasPaper ? cleanPaperYear(p?.year) : null,
  };
  // The one place that marks an item as a file share (/files, not Promote):
  // sharing it from /share.
  if (markAsFileShare) fields.is_file_share = true;

  const save = (f: Record<string, unknown>) =>
    db.from("promote_showcase").update(f).eq("id", input.id).eq("owner_id", userId);
  // A migration not run yet (paper_year, is_file_share): save without it.
  const { error } = await withOptionalColumns(["paper_year", "is_file_share"], (present) => {
    const f = { ...fields };
    if (!present.includes("paper_year")) delete f.paper_year;
    if (!present.includes("is_file_share")) delete f.is_file_share;
    return save(f);
  });
  if (error) throw error;

  return { published: row.published === true, headline, title };
}

export async function shareFileItem(input: {
  id: string;
  type: ShowcaseType;
  title: string;
  paper: ShareFilePaper | null;
}): Promise<{ slug: string }> {
  const { user, db } = await requireCurrentUser();
  const saved = await saveFileShareFields(db, user.id, input, true);
  if (!saved.published) await regenerateSlugFromHeadline(db, input.id, user.id, saved.headline, saved.title);
  return setArticlePublished(input.id, true);
}

/** "Save changes" on the Manage screen: title, type and paper. Does not
 *  change whether the page is public, nor its address. */
export async function updateFileShare(input: {
  id: string;
  type: ShowcaseType;
  title: string;
  paper: ShareFilePaper | null;
}): Promise<void> {
  const { user, db } = await requireCurrentUser();
  await saveFileShareFields(db, user.id, input, false);
}

/** A file share loaded for its owner's Manage screen (/files/<slug>/edit).
 *  Null for a signed-out visitor, an unknown slug, or someone else's item,
 *  all alike (the page 404s), same as getOwnedArticleForEdit. */
export type OwnedFileShare = {
  id: string;
  slug: string;
  isPublic: boolean;
  isFileShare: boolean;
  hasBody: boolean;
  type: ShowcaseType;
  title: string;
  paper: {
    title: string | null;
    authors: string | null;
    journal: string | null;
    doi: string | null;
    link: string | null;
    paperYear: number | null;
  };
  media: ShowcaseMedia[];
};

export async function getOwnedFileShare(slug: string): Promise<OwnedFileShare | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data: found, error } = await withOptionalColumns(["paper_year", "is_file_share"], (present) =>
    db
      .from("promote_showcase")
      .select(
        ["id, slug, type, headline, title, authors, journal, doi, link, article_body, published, owner_id", ...present].join(
          ", "
        )
      )
      .eq("slug", slug)
      .maybeSingle()
  );
  const data = found as unknown as Record<string, unknown> | null;
  if (error || !data || data.owner_id !== user.id) return null;

  const media = await listShowcaseMedia(db, data.id as string);
  return {
    id: data.id as string,
    slug: data.slug as string,
    isPublic: data.published === true,
    isFileShare: data.is_file_share === true,
    hasBody: Boolean(((data.article_body as string) ?? "").trim()),
    type: canonicalType(data.type as string),
    title: ((data.headline as string) || (data.title as string) || "").trim(),
    paper: {
      title: (data.title as string | null) ?? null,
      authors: (data.authors as string | null) ?? null,
      journal: (data.journal as string | null) ?? null,
      doi: (data.doi as string | null) ?? null,
      link: (data.link as string | null) ?? null,
      paperYear: cleanPaperYear(data.paper_year ?? null),
    },
    media,
  };
}

// ── media attachments ────────────────────────────────────────────────────────
//
// Any number of files per article, stored in the PRIVATE showcase-media
// bucket under the article's own id: `<showcase_id>/<uuid>-<clean name>`
// (older rows: `<showcase_id>/<uuid>.<ext>`). The article id as the first
// folder, not the uploader's uid, is what lets the storage RLS policies key
// off promote_showcase.published (see the 2026-09-06 migrations).
//
// The browser uploads straight to Storage (resumable, components/promote/
// MediaUploader.tsx); the bytes never pass through a Server Action. Once the
// upload is done, recordShowcaseMedia() below checks the object and writes
// the row. Every read mints a fresh signed URL; the only stable link is the
// per-file download route, /files/<slug>/download/<id>, for published items.

export const SHOWCASE_MEDIA_BUCKET = "showcase-media";

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes, matches lib/server/projects.ts's proposal-file convention
const DOWNLOAD_URL_TTL_SECONDS = 60; // the permanent link re-signs on every click

/** Mint a short-lived signed URL for one object path. Throws if the calling
 *  client's role can't pass the bucket's SELECT policy for that path (an
 *  owner-only draft file requested by the anon client, for instance) — RLS
 *  is what actually decides this, not this function. */
async function signMediaPath(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage
    .from(SHOWCASE_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("Couldn't sign the media URL.");
  return data.signedUrl;
}

const MEDIA_COLUMNS = "id, kind, url, filename, size_bytes, label";
const MEDIA_COLUMNS_BEFORE_LABEL = "id, kind, url, filename, size_bytes";

/** A column a migration adds is not there yet: Postgres "undefined column"
 *  (42703, on a select or filter) or PostgREST "column not in the schema
 *  cache" (PGRST204, on an insert/update). Callers then fall back to working
 *  without it, so nothing breaks between a deploy and running the file. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

type DbError = { code?: string; message?: string; details?: string } | null;

/** Which of `optional` a missing-column error is about, or null when the
 *  error is something else (or there is none). */
function missingOptionalColumn(error: DbError, optional: readonly string[]): string | null {
  if (!isMissingColumn(error)) return null;
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return optional.find((c) => text.includes(c)) ?? null;
}

/** Run a query that uses some columns added by not-yet-run migrations
 *  (paper_year, is_file_share). Each time the database says one of them is
 *  missing, run again without it. */
type LooseResult = { data: unknown; error: DbError };

async function withOptionalColumns(
  optional: readonly string[],
  run: (present: string[]) => PromiseLike<LooseResult>
): Promise<LooseResult> {
  let present = [...optional];
  for (;;) {
    const res = await run(present);
    const missing = missingOptionalColumn(res.error, present);
    if (!missing) return res;
    present = present.filter((c) => c !== missing);
  }
}

/** List a showcase's attached media as signed URLs. Used both by the owner's
 *  own editor (called with the session client — covered by the "own" RLS
 *  policies) and by the public article page (called with the ANON client —
 *  covered by the "parent is published" policies). Same function either
 *  way; Postgres RLS on both promote_showcase_media and storage.objects
 *  decides what the given client is actually allowed to see and sign. */
export async function listShowcaseMedia(db: Db, showcaseId: string): Promise<ShowcaseMedia[]> {
  const query = (columns: string) =>
    db
      .from("promote_showcase_media")
      .select(columns)
      .eq("showcase_id", showcaseId)
      .order("created_at", { ascending: true });

  let { data, error } = await query(MEDIA_COLUMNS);
  if (isMissingColumn(error)) ({ data, error } = await query(MEDIA_COLUMNS_BEFORE_LABEL));
  if (error || !data) return [];

  const withUrls = await Promise.all(
    (data as unknown as Record<string, unknown>[]).map(async (row) => {
      try {
        return {
          ...mediaFromRow(row),
          url: await signMediaPath(db, row.url as string),
        };
      } catch {
        return null; // an unsignable/orphaned row is dropped, not fatal to the list
      }
    })
  );
  return withUrls.filter((m): m is ShowcaseMedia => m !== null);
}

function mediaFromRow(row: Record<string, unknown>): Omit<ShowcaseMedia, "url"> {
  return {
    id: row.id as string,
    kind: row.kind as MediaKind,
    filename: row.filename as string,
    sizeBytes: Number(row.size_bytes),
    label: (row.label as string | null | undefined) ?? null,
  };
}

/** Thrown for anything about a reported upload that doesn't check out. The
 *  message is safe to show to the user. */
export class MediaRecordError extends Error {}

/** Record a file the browser has ALREADY uploaded to Storage, as the owner of
 *  the showcase. Nothing the browser says about the file is trusted except
 *  its original name (for display):
 *    - the path must be one buildMediaObjectPath() makes for THIS showcase;
 *    - the caller must own the showcase (checked here, and again by the
 *      insert RLS policy). Only the showcase's owner can write into its
 *      folder at all (storage policy showcase_media_owner_insert), so an
 *      object in that folder of a showcase the caller owns is the caller's;
 *    - the object must really exist: its size and content type are read from
 *      Storage, never from the browser;
 *    - an object over the size limit, or empty, is deleted and refused. */
export async function recordShowcaseMedia(input: {
  showcaseId: string;
  path: string;
  filename: string;
}): Promise<ShowcaseMedia> {
  const { user, db } = await requireCurrentUser();
  const { showcaseId, path } = input;

  if (!isUuid(showcaseId) || !isMediaObjectPathFor(path, showcaseId)) {
    throw new MediaRecordError("That upload doesn't belong to this item.");
  }

  const { data: item } = await db
    .from("promote_showcase")
    .select("id")
    .eq("id", showcaseId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!item) throw new MediaRecordError("That upload doesn't belong to this item.");

  const { data: existing } = await db
    .from("promote_showcase_media")
    .select("id")
    .eq("showcase_id", showcaseId)
    .eq("url", path)
    .maybeSingle();
  if (existing) throw new MediaRecordError("That file is already attached.");

  const bucket = db.storage.from(SHOWCASE_MEDIA_BUCKET);
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError || !info) {
    throw new MediaRecordError("The upload wasn't found in storage. Please upload the file again.");
  }
  const infoRecord = info as unknown as Record<string, unknown>;
  // Belt-and-suspenders: if Storage reports who wrote the object, it must be
  // the caller. (The folder rule above is the real guarantee.)
  const reportedOwner = (infoRecord.ownerId ?? infoRecord.owner) as string | undefined;
  if (reportedOwner && reportedOwner !== user.id) {
    throw new MediaRecordError("That upload doesn't belong to this item.");
  }
  const meta = (info.metadata ?? {}) as Record<string, unknown>;
  const size = Number(info.size ?? meta.size);
  const contentType = String(info.contentType ?? meta.mimetype ?? meta.contentType ?? "");

  if (!Number.isFinite(size) || size <= 0 || size > MAX_MEDIA_BYTES) {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.error("showcase media cleanup failed", rmErr, path);
    throw new MediaRecordError(
      size > MAX_MEDIA_BYTES
        ? `Files can be up to ${formatFileSize(MAX_MEDIA_BYTES)}.`
        : "That file is empty."
    );
  }

  const filename = displayFileName(input.filename);
  const kind = mediaKindFor(contentType, filename);

  const { data, error } = await db
    .from("promote_showcase_media")
    .insert({
      showcase_id: showcaseId,
      owner_id: user.id, // from the session, never the body
      kind,
      url: path, // the storage PATH — see the field comment in the migration
      filename,
      size_bytes: size,
    })
    .select("id, kind, filename, size_bytes")
    .single();

  if (error || !data) {
    // Leave no object the owner can never see or remove (it has no row).
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.error("showcase media cleanup failed", rmErr, path);
    console.error("recordShowcaseMedia insert failed", error);
    throw new MediaRecordError(
      kind === "file" && error?.code === "23514"
        ? "This kind of file can't be attached yet. Please ask an admin to run the latest database update."
        : "Couldn't save the attachment. Please try again."
    );
  }

  return {
    ...mediaFromRow({ ...(data as Record<string, unknown>), label: null }),
    url: await signMediaPath(db, path),
  };
}

/** Set (or clear, with an empty string) the label of one attached file, as
 *  the showcase's owner. Returns the label as stored. */
export async function updateShowcaseMediaLabel(
  showcaseId: string,
  mediaId: string,
  rawLabel: string
): Promise<string | null> {
  const { user, db } = await requireCurrentUser();
  if (!isUuid(showcaseId) || !isUuid(mediaId)) throw new MediaRecordError("File not found.");

  const label = cleanMediaLabel(rawLabel);
  const { data, error } = await db
    .from("promote_showcase_media")
    .update({ label })
    .eq("id", mediaId)
    .eq("showcase_id", showcaseId)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new MediaRecordError("File not found.");
  return label;
}

/** Remove one attached file as the showcase's owner. */
export async function removeShowcaseMedia(showcaseId: string, mediaId: string): Promise<void> {
  const { user, db } = await requireCurrentUser();

  // A public file page (no body text) must keep at least one file.
  const [{ data: item }, { count }] = await Promise.all([
    db
      .from("promote_showcase")
      .select("published, article_body")
      .eq("id", showcaseId)
      .eq("owner_id", user.id)
      .maybeSingle(),
    db
      .from("promote_showcase_media")
      .select("id", { count: "exact", head: true })
      .eq("showcase_id", showcaseId),
  ]);
  if (item) {
    const allowed = canRemoveFile({
      isPublic: item.published === true,
      hasBody: Boolean(((item.article_body as string) ?? "").trim()),
      fileCount: count ?? 0,
    });
    if (!allowed.ok) throw new MediaRecordError(allowed.message);
  }

  const { data, error } = await db
    .from("promote_showcase_media")
    .delete()
    .eq("id", mediaId)
    .eq("showcase_id", showcaseId)
    .eq("owner_id", user.id)
    .select("url")
    .maybeSingle();
  if (error) throw error;

  const path = (data?.url as string) ?? null;
  if (path) {
    const { error: rmErr } = await db.storage.from(SHOWCASE_MEDIA_BUCKET).remove([path]);
    if (rmErr) console.error("showcase media cleanup failed", rmErr, path);
  }
}

/** A 60-second signed URL that downloads one NON-image file of a PUBLISHED
 *  article under its original filename, for the permanent link
 *  /promote/<slug>/files/<mediaId>. Null for an unknown or draft slug, an
 *  unknown file, a file of another article, or an image.
 *
 *  Everything goes through the ANON client, so a draft can never resolve
 *  here: promote_showcase, promote_showcase_media and storage.objects all
 *  only let anon see rows of a published article. The .eq("published") and
 *  the folder check below are belt-and-suspenders on top of that. */
export async function getPublishedFileDownloadUrl(slug: string, mediaId: string): Promise<string | null> {
  if (!slug || !isUuid(mediaId)) return null;
  const anon = getAnonServerClient();
  if (!anon) throw new ServerConfigError();

  const { data: item } = await anon
    .from("promote_showcase")
    .select("id")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (!item) return null;
  const showcaseId = item.id as string;

  const { data: file } = await anon
    .from("promote_showcase_media")
    .select("id, kind, url, filename")
    .eq("id", mediaId)
    .eq("showcase_id", showcaseId)
    .maybeSingle();
  if (!file || file.kind === "image") return null;

  const path = file.url as string;
  if (!path || !path.startsWith(`${showcaseId}/`)) return null;

  const { data, error } = await anon.storage
    .from(SHOWCASE_MEDIA_BUCKET)
    .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, {
      download: displayFileName(file.filename as string),
    });
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── public article page ──────────────────────────────────────────────────────

const PUBLIC_ARTICLE_SELECT =
  "id, slug, type, headline, standfirst, article_body, linkedin_post, title, authors, doi, link, journal, image_url, tags, created_at, published_at, owner_id, key_facts, cta_label, cta_url, quote, quote_by, share_text, event_starts_at, event_location, community_id";

/** The owner's public profile slug (/researchers/<slug>), or null when their
 *  profile is private or has no slug. Read through the ANON client, so the
 *  users table's own "is_public = true" policy decides; the .eq is the same
 *  rule stated again. Only the slug is selected, never email or anything else. */
async function publicProfileSlug(anon: Db, ownerId: string): Promise<string | null> {
  if (!ownerId) return null;
  const { data, error } = await anon
    .from("users")
    .select("profile_slug")
    .eq("id", ownerId)
    .eq("is_public", true)
    .maybeSingle();
  if (error || !data) return null;
  const slug = (data.profile_slug as string | null) ?? null;
  return slug && slug.trim() ? slug : null;
}

/** Look up a PUBLISHED article by slug, for the public /promote/[slug] page.
 *
 *  Uses the ANON client deliberately, not getDb()/the session client — this
 *  route has no signed-in "viewer" concept, and reading through the session
 *  client here would mean a signed-in owner browsing their own draft's URL
 *  in another tab could see it render as if it were public, when the actual
 *  guarantee needs to hold for every visitor including a fully signed-out
 *  one. The `.eq("published", true)` below is belt-and-suspenders, same
 *  idiom as the owner_id checks elsewhere in this file — the real gate is
 *  the promote_showcase_select_published RLS policy, which the anon client
 *  is subject to like any other unauthenticated reader. Attached media is
 *  read through the SAME anon client, so a draft's still-private files stay
 *  unsignable here even if this query somehow returned one. */
export async function getPublishedArticleBySlug(slug: string): Promise<PublicArticle | null> {
  const anon = getAnonServerClient();
  if (!anon) throw new ServerConfigError();

  const read = (columns: string) =>
    anon
      .from("promote_showcase")
      .select(columns)
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
  const { data: found, error } = await withOptionalColumns(["paper_year", "is_file_share"], (present) =>
    read([PUBLIC_ARTICLE_SELECT, ...present].join(", "))
  );

  if (error || !found) return null;
  const data = found as unknown as Record<string, unknown> & { id: string };
  await attachCommunities([data as Record<string, unknown>]);

  // Owner name/affiliation via the SAME showcase_owners() function
  // ownerMap() wraps for the gallery — never a plain join on public.users
  // (see the file header). Reusing ownerMap() here costs one RPC call that
  // returns every showcase owner rather than just this one, but it's the
  // one function the anon client is actually granted EXECUTE on, and this
  // page's own RLS-scoped Postgres round trip is already the more expensive
  // part of the request.
  const [media, owners, ownerProfileSlug] = await Promise.all([
    listShowcaseMedia(anon, data.id as string),
    ownerMap(anon),
    publicProfileSlug(anon, data.owner_id as string),
  ]);

  const type = canonicalType(data.type as string);
  const standfirst = (data.standfirst as string) ?? "";
  const articleBody = (data.article_body as string) ?? "";
  const shareText = normalizeShareTexts(data.share_text);
  if (!shareText.linkedin.trim()) shareText.linkedin = (data.linkedin_post as string) ?? "";
  // A talk with no link of its own offers its first attached deck instead.
  const deck = media.find((m) => m.kind === "slides")?.url ?? null;
  const cta = resolveCta(
    type,
    {
      ctaLabel: data.cta_label as string | null,
      ctaUrl: data.cta_url as string | null,
      link: data.link as string | null,
      doi: data.doi as string | null,
    },
    deck ?? firstLinkIn(articleBody)
  );

  return {
    id: data.id as string,
    tags: (data.tags as string[]) ?? [],
    keyFacts: factsForRow(type, data.key_facts),
    cta,
    quote: ((data.quote as string | null) ?? "").trim() || null,
    quoteBy: ((data.quote_by as string | null) ?? "").trim() || null,
    shareText,
    eventStartsAt: (data.event_starts_at as string | null) ?? null,
    eventLocation: (data.event_location as string | null) ?? null,
    slug: data.slug as string,
    type,
    headline: (data.headline as string) || (data.title as string),
    standfirst,
    articleBody,
    linkedinPost: (data.linkedin_post as string) ?? "",
    title: data.title as string,
    authors: (data.authors as string) ?? "",
    doi: (data.doi as string | null) ?? null,
    link: (data.link as string | null) ?? null,
    journal: (data.journal as string | null) ?? null,
    image_url: (data.image_url as string | null) ?? null,
    media,
    community: toCommunity(data as Record<string, unknown>),
    created_at: data.created_at as string,
    publishedAt: (data.published_at as string | null) ?? null,
    owner: owners.get(data.owner_id as string) ?? null,
    ownerProfileSlug,
    paperYear: cleanPaperYear(data.paper_year ?? null),
    isFileShare: data.is_file_share === true,
  };
}

/** Is the signed-in viewer this article's owner? Used by the public article
 *  page ONLY to decide whether to render an "Edit" link — never to gate the
 *  edit page itself (getOwnedArticleForEdit below does that, independently,
 *  since a link being hidden is not the same thing as a route being
 *  protected). Signed out or no such slug both come back false, same
 *  outcome either way from the caller's point of view. */
export async function isOwnerOfShowcase(slug: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;

  const db = await getDb();
  if (!db) return false;

  const { data, error } = await db
    .from("promote_showcase")
    .select("owner_id")
    .eq("slug", slug)
    .maybeSingle();

  return !error && data?.owner_id === user.id;
}

// ── edit route (owner only) ─────────────────────────────────────────────────

export type OwnedArticleForEdit = {
  entry: ArticleEditorEntry;
  media: ShowcaseMedia[];
};

/** Look up ANY (draft or published) showcase entry by slug for its owner to
 *  edit — app/promote/[slug]/edit/page.tsx. Returns null for a signed-out
 *  visitor, an unknown slug, or a slug that exists but belongs to someone
 *  else, so the caller can 404 uniformly across all three — "not found" and
 *  "not yours" must look identical from the outside, or the URL becomes a
 *  probe for which slugs exist and who owns them.
 *
 *  Deliberately does NOT reuse getPublishedArticleBySlug: that function is
 *  published-only and anon-client-only by design (the public page), neither
 *  of which is right here — an unpublished draft is exactly what this needs
 *  to find, and doing that through the session client (not anon) is what
 *  lets promote_showcase_select_own even see it. The .eq check against
 *  owner_id below is still required on top of RLS: RLS's OTHER policy
 *  (promote_showcase_select_published) would happily hand back someone
 *  ELSE'S already-published article to any signed-in reader, which is
 *  correct for the public page but must not be treated as "yours to edit"
 *  here. */
export async function getOwnedArticleForEdit(slug: string): Promise<OwnedArticleForEdit | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data: row, error } = await withOptionalColumns(["is_file_share"], (present) =>
    db
      .from("promote_showcase")
      .select(
        [
          "id, slug, type, headline, standfirst, article_body, linkedin_post, community_id, authors, published, owner_id, key_facts, cta_label, cta_url, quote, quote_by, share_text, event_starts_at, event_location, featured, link, doi",
          ...present,
        ].join(", ")
      )
      .eq("slug", slug)
      .maybeSingle()
  );
  const data = row as unknown as Record<string, unknown> | null;

  if (error || !data || data.owner_id !== user.id) return null;

  const media = await listShowcaseMedia(db, data.id as string);
  const type = canonicalType(data.type as string);
  const standfirst = (data.standfirst as string) ?? "";
  const articleBody = (data.article_body as string) ?? "";
  const shareText = normalizeShareTexts(data.share_text);
  if (!shareText.linkedin.trim()) shareText.linkedin = (data.linkedin_post as string) ?? "";

  return {
    entry: {
      id: data.id as string,
      slug: data.slug as string,
      published: Boolean(data.published),
      isFileShare: data.is_file_share === true,
      type,
      headline: (data.headline as string) ?? "",
      standfirst,
      articleBody,
      linkedinPost: (data.linkedin_post as string) ?? "",
      communityId: (data.community_id as string | null) ?? null,
      authors: (data.authors as string) ?? "",
      // The three slots as stored (blank where nothing is stored). The editor
      // fills them by hand or with "Suggest key facts"; nothing is derived.
      keyFacts: normalizeKeyFacts(type, data.key_facts),
      ctaLabel: (data.cta_label as string | null) ?? "",
      ctaUrl: (data.cta_url as string | null) ?? "",
      quote: (data.quote as string | null) ?? "",
      quoteBy: (data.quote_by as string | null) ?? "",
      shareText,
      eventStartsAt: (data.event_starts_at as string | null) ?? null,
      eventLocation: (data.event_location as string | null) ?? "",
      featured: Boolean(data.featured),
      isAdmin: await isSiteAdmin(),
    },
    media,
  };
}

// ── shared files (/files) ────────────────────────────────────────────────────

/** One row on /files. Never carries owner_id; `ownerName` comes from
 *  showcase_owners() (name only), same as the Promote cards. */
export type FileShareListItem = {
  id: string;
  slug: string;
  title: string;
  type: ShowcaseType;
  /** Published date when published, otherwise the date it was made. */
  date: string;
  published: boolean;
  ownerName: string | null;
  /** The linked paper's title, or null when there is no paper. */
  paperTitle: string | null;
};

const FILE_SHARE_LIST_SELECT =
  "id, slug, type, title, headline, doi, link, published, published_at, created_at, owner_id, is_file_share";

function toFileShareItem(r: Record<string, unknown>, owners: Map<string, ShowcaseOwner>): FileShareListItem {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: ((r.headline as string) || (r.title as string) || "").trim(),
    type: canonicalType(r.type as string),
    date: ((r.published ? r.published_at : null) as string | null) ?? (r.created_at as string),
    published: r.published === true,
    ownerName: owners.get(r.owner_id as string)?.name ?? null,
    paperTitle: linkedPaperTitle({
      title: r.title as string | null,
      doi: r.doi as string | null,
      link: r.link as string | null,
    }),
  };
}

/** "Your files": the signed-in person's own file shares, published or not,
 *  newest first. [] when signed out, or before the is_file_share column
 *  exists (there are no file shares to list until then). Reads through the
 *  session client; promote_showcase's own-row policy is what lets a draft
 *  through, and the owner_id filter is the same rule stated again. */
export async function listMyFileShares(): Promise<FileShareListItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const db = await getDb();
  if (!db) throw new ServerConfigError();

  const { data, error } = await db
    .from("promote_showcase")
    .select(FILE_SHARE_LIST_SELECT)
    .eq("owner_id", user.id)
    .eq("is_file_share", true)
    .not("slug", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];

  const rows = (data as unknown as Record<string, unknown>[]).filter((r) =>
    listedInYourFiles(
      { published: r.published === true, is_file_share: r.is_file_share as boolean, owner_id: r.owner_id as string },
      user.id
    )
  );
  const owners = await ownerMap(db);
  return rows.map((r) => toFileShareItem(r, owners));
}

/** "Recently shared": everyone's PUBLISHED file shares, newest first. Read
 *  through the ANON client, so it is the same list for every visitor and a
 *  draft can never appear, whoever is looking. */
export async function listRecentFileShares(limit = 50): Promise<FileShareListItem[]> {
  const anon = getAnonServerClient();
  if (!anon) throw new ServerConfigError();

  const { data, error } = await anon
    .from("promote_showcase")
    .select(FILE_SHARE_LIST_SELECT)
    .eq("published", true)
    .eq("is_file_share", true)
    .not("slug", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  const rows = (data as unknown as Record<string, unknown>[]).filter((r) =>
    listedInRecentlyShared({ published: r.published === true, is_file_share: r.is_file_share as boolean })
  );
  const owners = await ownerMap(anon);
  return rows.map((r) => toFileShareItem(r, owners));
}
