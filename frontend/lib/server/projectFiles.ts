// lib/server/projectFiles.ts — files shared inside a project, on its Files tab
// (public.project_files + the private project-files bucket,
// database/migrations/2026-11-19_project_files*.sql).
//
// THE FLOW: the browser uploads a file straight to Storage, into
// `<project_id>/<uuid>-<clean name>` (components/uploads/useResumableUploads.ts),
// then calls recordProjectFile with that path. Nothing the browser says is
// trusted except the original filename and the optional title: the path must
// be one buildProjectFilePath makes for THIS project, the caller must be a
// member, and the size and type are read from Storage.
//
// OPENING A FILE: never a signed URL baked into the page. The list links to
// /projects/<id>/files/<file id> (app/projects/[id]/files/[fileId]/route.ts),
// which checks membership on every click and redirects to a 60-second signed
// URL that downloads under the original filename.
//
// AUTH: through lib/auth.ts only. RLS is the real gate (members read and add;
// the uploader or a lead / manager removes); the checks here give clear
// messages first. The viewer's uploader id is compared here and only a
// boolean (`can_remove`) reaches the client, never `added_by` itself.

import { getSession, requireCurrentUser, type Db } from "@/lib/auth";
import { hasProjectMemberRow } from "@/lib/server/projectWorkspace/colabofest";
import { cleanMediaLabel, displayFileName, fileExtension, isUuid } from "@/lib/server/promote/mediaFiles";
import {
  canRemoveProjectFile,
  checkProjectFileType,
  isProjectFilePathFor,
  MAX_PROJECT_FILE_BYTES,
  PROJECT_FILES_BUCKET,
  projectFileHref,
  projectFileKind,
  type ProjectFileKind,
} from "@/lib/server/projectFileRules";

const DOWNLOAD_URL_TTL_SECONDS = 60; // the stable link re-signs on every click

/** One shared file as the Files tab shows it. */
export type ProjectFile = {
  id: string;
  /** The title, or the filename when none was given. */
  title: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  kind: ProjectFileKind;
  /** The sharer's name, or null when unknown (left the project, account gone). */
  sharedBy: string | null;
  canRemove: boolean;
  /** The stable members-only link. */
  href: string;
};

/** Thrown for anything a member can fix or should know; safe to show. */
export class ProjectFileError extends Error {}

type Row = {
  id: string;
  project_id: string;
  added_by: string | null;
  path: string;
  filename: string;
  title: string | null;
  size_bytes: number | string;
  created_at: string;
};

const COLUMNS = "id, project_id, added_by, path, filename, title, size_bytes, created_at";

async function viewerRole(db: Db, projectId: string, userId: string): Promise<string | null> {
  const { data } = await db
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .limit(1);
  const row = Array.isArray(data) ? (data[0] as { role?: string } | undefined) : undefined;
  return row?.role ?? null;
}

function toFile(row: Row, viewerId: string, role: string | null, names: Record<string, string>): ProjectFile {
  return {
    id: row.id,
    title: row.title || row.filename,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    kind: projectFileKind(row.filename),
    sharedBy: row.added_by ? names[row.added_by] ?? null : null,
    canRemove: canRemoveProjectFile({ viewerId, addedBy: row.added_by, role }),
    href: projectFileHref(row.project_id, row.id),
  };
}

export type ListProjectFilesResult = { status: "ok"; files: ProjectFile[] } | { status: "error"; error: string };

/** Every file shared in the project, newest first. `names` maps a member's
 *  user id to the name to show (the page already has the roster). */
export async function listProjectFiles(projectId: string, names: Record<string, string>): Promise<ListProjectFilesResult> {
  const { user, db } = await requireCurrentUser();
  if (!isUuid(projectId)) return { status: "error", error: "Project not found." };

  const [role, res] = await Promise.all([
    viewerRole(db, projectId, user.id),
    db.from("project_files").select(COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }),
  ]);
  if (!role) return { status: "error", error: "You need to be a member of this project to see its files." };
  if (res.error) {
    console.error("listProjectFiles failed", res.error);
    // 42P01: the table isn't there yet (migration not run).
    return {
      status: "error",
      error:
        res.error.code === "42P01"
          ? "Shared files aren't set up yet. Ask a site admin to run the latest database update."
          : "Couldn't load the shared files. Please try again.",
    };
  }
  return { status: "ok", files: ((res.data ?? []) as Row[]).map((r) => toFile(r, user.id, role, names)) };
}

/** How many files are shared in the project, for the Files tile on a CollaboFest
 *  home. A head-only count (no rows sent); RLS means a non-member gets 0. null when
 *  it can't be read (for example the table isn't there yet), never an error. */
export async function countProjectFiles(projectId: string): Promise<number | null> {
  if (!isUuid(projectId)) return null;
  const { db } = await requireCurrentUser();
  const { count, error } = await db
    .from("project_files")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (error) {
    if (error.code !== "42P01") console.error("countProjectFiles failed", error);
    return null;
  }
  return count ?? 0;
}

/** Record a file the browser has ALREADY uploaded to Storage, as a member of
 *  the project. An object that fails a check is deleted, so nothing stays in
 *  Storage that no list shows. */
export async function recordProjectFile(input: {
  projectId: string;
  path: string;
  filename: string;
  title: string;
}): Promise<ProjectFile> {
  const { user, db } = await requireCurrentUser();
  const { projectId, path } = input;

  // 1. The path must be inside THIS project's folder, in the shape we make.
  if (!isUuid(projectId) || !isProjectFilePathFor(path, projectId)) {
    throw new ProjectFileError("That upload doesn't belong to this project.");
  }

  // 2. The caller must be a member (RLS checks again on insert).
  const role = await viewerRole(db, projectId, user.id);
  if (!role) throw new ProjectFileError("You need to be a member of this project to share files here.");

  const { data: existing } = await db.from("project_files").select("id").eq("path", path).maybeSingle();
  if (existing) throw new ProjectFileError("That file is already shared.");

  // 3. The object must exist; its size and type come from Storage.
  const bucket = db.storage.from(PROJECT_FILES_BUCKET);
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError || !info) {
    throw new ProjectFileError("The upload wasn't found in storage. Please upload the file again.");
  }
  const infoRecord = info as unknown as Record<string, unknown>;
  const reportedOwner = (infoRecord.ownerId ?? infoRecord.owner) as string | undefined;
  if (reportedOwner && reportedOwner !== user.id) {
    throw new ProjectFileError("That upload doesn't belong to this project.");
  }
  const meta = (info.metadata ?? {}) as Record<string, unknown>;
  const size = Number(info.size ?? meta.size);
  const storedType = String(info.contentType ?? meta.mimetype ?? meta.contentType ?? "");

  const filename = displayFileName(input.filename);
  const refuse = async (message: string): Promise<never> => {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.error("project file cleanup failed", rmErr, path);
    throw new ProjectFileError(message);
  };

  if (!Number.isFinite(size) || size <= 0) await refuse("That file is empty.");
  if (size > MAX_PROJECT_FILE_BYTES) await refuse("Files can be up to 50 MB.");
  // The name people download must have the same extension as what was stored,
  // and the stored type must fit that extension.
  if (fileExtension(filename) !== fileExtension(path)) await refuse("That upload doesn't match the file you picked.");
  const type = checkProjectFileType(filename, storedType);
  if (!type.ok) await refuse(type.message);
  const contentType = type.ok ? type.contentType : storedType;

  const { data, error } = await db
    .from("project_files")
    .insert({
      project_id: projectId,
      added_by: user.id, // from the session, never the body
      path,
      filename,
      title: cleanMediaLabel(input.title),
      size_bytes: size,
      content_type: contentType,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    console.error("recordProjectFile insert failed", error);
    await refuse("Couldn't save the file. Please try again.");
  }

  return toFile(data as Row, user.id, role, {});
}

/** Remove one shared file: the member who shared it, or a project lead or
 *  manager. The row goes first (RLS decides), then the object. */
export async function removeProjectFile(projectId: string, fileId: string): Promise<void> {
  const { db } = await requireCurrentUser();
  if (!isUuid(projectId) || !isUuid(fileId)) throw new ProjectFileError("File not found.");

  const { data, error } = await db
    .from("project_files")
    .delete()
    .eq("id", fileId)
    .eq("project_id", projectId)
    .select("path")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new ProjectFileError("Only the person who shared this file, or a project lead or manager, can remove it.");
  }

  const { error: rmErr } = await db.storage.from(PROJECT_FILES_BUCKET).remove([(data as { path: string }).path]);
  if (rmErr) console.error("project file storage cleanup failed", rmErr, data);
}

export type ProjectFileDownload =
  | { status: "ok"; url: string }
  | { status: "signed_out" }
  | { status: "not_member" }
  | { status: "not_found" }
  | { status: "error" };

/** A fresh 60-second signed URL for one file, for a member of the project
 *  only. Checked on every call: the stable link alone is never enough. */
export async function getProjectFileDownloadUrl(projectId: string, fileId: string): Promise<ProjectFileDownload> {
  const session = await getSession();
  if (!session) return { status: "signed_out" };
  const { user, db } = session;
  if (!isUuid(projectId) || !isUuid(fileId)) return { status: "not_found" };

  if (!(await hasProjectMemberRow(db, projectId, user.id))) return { status: "not_member" };

  const { data: row, error } = await db
    .from("project_files")
    .select("path, filename")
    .eq("id", fileId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    console.error("getProjectFileDownloadUrl: lookup failed", error);
    return { status: "error" };
  }
  if (!row) return { status: "not_found" };

  const { data, error: signErr } = await db.storage
    .from(PROJECT_FILES_BUCKET)
    .createSignedUrl(row.path as string, DOWNLOAD_URL_TTL_SECONDS, {
      download: displayFileName(row.filename as string),
    });
  if (signErr || !data?.signedUrl) {
    console.error("getProjectFileDownloadUrl: sign failed", signErr);
    return { status: "error" };
  }
  return { status: "ok", url: data.signedUrl as string };
}

/** Delete every stored object of a project: the paths of its rows plus
 *  anything else in its folder (an upload that was never recorded). Called by
 *  lib/server/projects.ts:deleteProject before the project row goes; the rows
 *  themselves go with the project (ON DELETE CASCADE). Best effort: a failure
 *  is logged, never blocks the delete. */
export async function removeAllProjectFileObjects(db: Db, projectId: string): Promise<void> {
  if (!isUuid(projectId)) return;
  const bucket = db.storage.from(PROJECT_FILES_BUCKET);
  const paths = new Set<string>();

  const { data: rows, error: rowsErr } = await db.from("project_files").select("path").eq("project_id", projectId);
  if (rowsErr && rowsErr.code !== "42P01") console.error("project files cleanup: row lookup failed", rowsErr);
  for (const r of (rows ?? []) as { path: string }[]) paths.add(r.path);

  // Paginated listing of the project's folder.
  const PAGE = 100;
  for (let offset = 0; offset < 10_000; offset += PAGE) {
    const { data: objects, error: listErr } = await bucket.list(projectId, { limit: PAGE, offset });
    if (listErr) {
      console.error("project files cleanup: folder listing failed", listErr);
      break;
    }
    const list = (objects ?? []) as { name: string; id?: string | null }[];
    for (const o of list) if (o.name && o.id) paths.add(`${projectId}/${o.name}`);
    if (list.length < PAGE) break;
  }

  const all = Array.from(paths);
  for (let i = 0; i < all.length; i += PAGE) {
    const { error } = await bucket.remove(all.slice(i, i + PAGE));
    if (error) console.error("project files cleanup: remove failed", error);
  }
}
