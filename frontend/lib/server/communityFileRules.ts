// lib/server/communityFileRules.ts — the rules for files attached to a community or
// team resource (public.community_resource_files + the private
// community-resource-files bucket, database/migrations/2026-09-21_community_resource_files*.sql
// and 2026-10-28_teams_storage.sql), as pure functions: the path an upload goes to,
// which files are accepted, the content type sent to Storage, and the checks the
// server runs on an object before it writes the row. No I/O, no next/* imports, so
// `npm test` runs it and the browser uploader can import it as well as
// lib/server/communities.ts.

import { buildMediaObjectPath, displayFileName, fileExtension, isMediaObjectPathFor, mediaKindFor, type MediaFileKind } from "./promote/mediaFiles.ts";
import { acceptListFor, checkFileTypeFor, contentTypesFor, standardContentType } from "./uploads/fileTypes.ts";

export const COMMUNITY_RESOURCE_FILES_BUCKET = "community-resource-files";

/** 50 MB, the bucket's own file_size_limit. */
export const MAX_COMMUNITY_FILE_BYTES = 50 * 1024 * 1024;

/** The bucket's allowed types, by extension. */
export const COMMUNITY_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "pptx"] as const;

export const COMMUNITY_FILE_TYPES_LABEL = "PNG, JPEG, WebP, GIF, PDF or PPTX";

/** The file picker's `accept`. */
export const COMMUNITY_FILE_ACCEPT = acceptListFor(COMMUNITY_FILE_EXTENSIONS);

/** Exactly the bucket's allowed_mime_types (2026-09-21_community_resource_files_storage.sql). */
export const COMMUNITY_FILE_CONTENT_TYPES = contentTypesFor(COMMUNITY_FILE_EXTENSIONS);

export type CommunityFileTypeCheck = { ok: true; contentType: string } | { ok: false; message: string };

/** Is this file accepted? The extension decides; the reported type must fit it
 *  (or be empty / generic). `contentType` is the standard type for the extension. */
export function checkCommunityFileType(filename: string, reportedType: string | null | undefined): CommunityFileTypeCheck {
  const name = displayFileName(filename);
  const t = checkFileTypeFor(filename, reportedType, COMMUNITY_FILE_EXTENSIONS);
  if (!t.ok) {
    return t.reason === "extension"
      ? { ok: false, message: `"${name}" can't be attached here. Use ${COMMUNITY_FILE_TYPES_LABEL}.` }
      : { ok: false, message: `"${name}" doesn't look like the kind of file its name says it is.` };
  }
  return { ok: true, contentType: t.contentType };
}

/** The message for a file the uploader refuses before sending anything, or null. */
export function communityFileProblem(filename: string, reportedType: string | null | undefined, sizeBytes: number): string | null {
  const type = checkCommunityFileType(filename, reportedType);
  if (!type.ok) return type.message;
  if (sizeBytes <= 0) return `"${displayFileName(filename)}" is empty.`;
  if (sizeBytes > MAX_COMMUNITY_FILE_BYTES) return `"${displayFileName(filename)}" is over 50 MB.`;
  return null;
}

/** The content type an upload is sent with: the standard one for its extension
 *  (a .pptx the browser reports as empty or zip still goes up as PPTX). */
export function communityUploadContentType(filename: string, reportedType: string | null | undefined): string {
  return standardContentType(filename, reportedType, COMMUNITY_FILE_EXTENSIONS);
}

/** The icon an attached file gets in an upload row. */
export function communityFileKind(filename: string): MediaFileKind {
  return mediaKindFor(null, filename);
}

/** The storage path for a new upload: `<community_id>/<uuid>-<clean name>`. The
 *  community's id is the first folder, which every storage policy keys on.
 *  Files stored before this (`<community_id>/<uuid>.<ext>`) keep their path in
 *  community_resource_files.url and still open and delete by that path; this
 *  shape only matters for NEW uploads. */
export function buildCommunityFilePath(communityId: string, fileId: string, filename: string): string {
  return buildMediaObjectPath(communityId, fileId, filename);
}

/** True only for a path buildCommunityFilePath could have made for THIS community. */
export function isCommunityFilePathFor(path: string, communityId: string): boolean {
  return isMediaObjectPathFor(path, communityId);
}

export type StoredFileCheck =
  | { ok: true; filename: string; sizeBytes: number; contentType: string }
  /** `deleteObject`: whether the server should remove the stored object. Never for a
   *  path outside this community's folder or an object someone else uploaded. */
  | { ok: false; message: string; deleteObject: boolean };

/** The checks recordCommunityResourceFile runs on an object the browser says it
 *  uploaded, before it writes the row. Membership is checked separately (it needs
 *  the database); everything else is here.
 *
 *  `ownerId`: the uploader as Storage reports it, or null when the response does
 *  not say (Supabase's info() does not document an owner field). When present it
 *  must be the caller; when absent the check cannot be made here. */
export function checkStoredCommunityFile(a: {
  communityId: string;
  path: string;
  filename: string;
  sizeBytes: number;
  storedType: string;
  ownerId: string | null;
  callerId: string;
}): StoredFileCheck {
  if (!isCommunityFilePathFor(a.path, a.communityId)) {
    return { ok: false, message: "That upload doesn't belong to this community.", deleteObject: false };
  }
  if (a.ownerId && a.ownerId !== a.callerId) {
    return { ok: false, message: "That upload doesn't belong to you.", deleteObject: false };
  }
  const filename = displayFileName(a.filename);
  if (!Number.isFinite(a.sizeBytes) || a.sizeBytes <= 0) {
    return { ok: false, message: "That file is empty.", deleteObject: true };
  }
  if (a.sizeBytes > MAX_COMMUNITY_FILE_BYTES) {
    return { ok: false, message: "Files can be up to 50 MB.", deleteObject: true };
  }
  // The name people see must have the same extension as what was stored, and the
  // stored type must fit that extension.
  if (fileExtension(filename) !== fileExtension(a.path)) {
    return { ok: false, message: "That upload doesn't match the file you picked.", deleteObject: true };
  }
  const type = checkCommunityFileType(filename, a.storedType);
  if (!type.ok) return { ok: false, message: type.message, deleteObject: true };
  return { ok: true, filename, sizeBytes: a.sizeBytes, contentType: type.contentType };
}

/** After a failed or cancelled upload: should the resource this form just created
 *  be deleted, so no empty titled entry is left behind? Only when this form made
 *  it, it has no link, no file got attached and nothing is still uploading. An
 *  edited (older) resource is never deleted. */
export function shouldDiscardNewResource(a: {
  createdHere: boolean;
  hasLink: boolean;
  attached: number;
  stillUploading: number;
}): boolean {
  return a.createdHere && !a.hasLink && a.attached === 0 && a.stillUploading === 0;
}
