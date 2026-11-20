// lib/server/projectFileRules.ts — the rules for files shared inside a project
// (public.project_files, database/migrations/2026-11-19_project_files*.sql),
// as pure functions: the path an upload goes to, which files are accepted,
// the content type sent to Storage, the icon a file gets and who may remove
// it. No I/O, no next/* imports, so `npm test` runs it with plain node and the
// browser uploader (components/projects/workspace/ProjectFilesSection.tsx)
// can import it as well as lib/server/projectFiles.ts.

import { buildMediaObjectPath, displayFileName, fileExtension, isMediaObjectPathFor } from "./promote/mediaFiles.ts";
import { FILE_TYPE_RULES, acceptListFor, checkFileTypeFor, type FileKind } from "./uploads/fileTypes.ts";

export const PROJECT_FILES_BUCKET = "project-files";

/** 50 MB, the bucket's own file_size_limit. */
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;

export type ProjectFileKind = FileKind;

/** Every extension the shared rules know: images, PDF, PowerPoint, Word and
 *  Excel (lib/server/uploads/fileTypes.ts). */
const PROJECT_FILE_EXTENSIONS = Object.keys(FILE_TYPE_RULES);

/** The file picker's `accept`: extensions and the standard types. */
export const PROJECT_FILE_ACCEPT = acceptListFor(PROJECT_FILE_EXTENSIONS);

export const PROJECT_FILE_TYPES_LABEL = "Images, PDF, PowerPoint, Word or Excel";

export type FileTypeCheck =
  | { ok: true; kind: ProjectFileKind; contentType: string }
  | { ok: false; message: string };

/** Is this file accepted? The extension must be one of the allowed ones, and
 *  the type the browser (or Storage) reports must fit that extension, or be
 *  empty / generic. On success, `contentType` is the standard type for the
 *  extension: the one to upload with and the one Storage must report back. */
export function checkProjectFileType(filename: string, reportedType: string | null | undefined): FileTypeCheck {
  const name = displayFileName(filename);
  const t = checkFileTypeFor(filename, reportedType, PROJECT_FILE_EXTENSIONS);
  if (!t.ok) {
    return t.reason === "extension"
      ? { ok: false, message: `"${name}" can't be shared here. Use ${PROJECT_FILE_TYPES_LABEL.toLowerCase()} files.` }
      : { ok: false, message: `"${name}" doesn't look like the kind of file its name says it is.` };
  }
  return { ok: true, kind: t.kind, contentType: t.contentType };
}

/** The message for a file the uploader refuses before sending anything, or
 *  null when it may be uploaded. */
export function projectFileProblem(filename: string, reportedType: string | null | undefined, sizeBytes: number): string | null {
  const type = checkProjectFileType(filename, reportedType);
  if (!type.ok) return type.message;
  if (sizeBytes <= 0) return `"${displayFileName(filename)}" is empty.`;
  if (sizeBytes > MAX_PROJECT_FILE_BYTES) return `"${displayFileName(filename)}" is over 50 MB.`;
  return null;
}

/** What kind a stored file is, by its name: decides the icon. */
export function projectFileKind(filename: string): ProjectFileKind {
  return FILE_TYPE_RULES[fileExtension(filename)]?.kind ?? "document";
}

/** Icon and colours for each kind. No green tints: the page's accent is UAB
 *  green #1A5632 on buttons and links only. */
export const PROJECT_FILE_KIND_STYLE: Record<ProjectFileKind, { icon: string; bg: string; fg: string; label: string }> = {
  pdf: { icon: "picture_as_pdf", bg: "#fde8e6", fg: "#b42318", label: "PDF" },
  slides: { icon: "slideshow", bg: "#ffedd5", fg: "#c2410c", label: "Slides" },
  document: { icon: "description", bg: "#e3ecf8", fg: "#1d4f91", label: "Document" },
  spreadsheet: { icon: "table_chart", bg: "#eceae4", fg: "#5b5a55", label: "Spreadsheet" },
  image: { icon: "image", bg: "#f1e8fd", fg: "#6d28d9", label: "Image" },
};

/** The storage path for a new upload: `<project_id>/<uuid>-<clean name>`. The
 *  project's id is the first folder, which every storage policy keys on. */
export function buildProjectFilePath(projectId: string, fileId: string, filename: string): string {
  return buildMediaObjectPath(projectId, fileId, filename);
}

/** True only for a path buildProjectFilePath could have made for THIS
 *  project. The server checks this before trusting a path the browser sends. */
export function isProjectFilePathFor(path: string, projectId: string): boolean {
  return isMediaObjectPathFor(path, projectId);
}

/** Who may remove a shared file: the member who shared it, or a project lead
 *  or manager. RLS enforces the same rule. */
export function canRemoveProjectFile(args: {
  viewerId: string;
  addedBy: string | null;
  role: string | null | undefined;
}): boolean {
  if (args.role === "lead" || args.role === "manager") return true;
  return !!args.addedBy && args.addedBy === args.viewerId;
}

/** The stable, members-only link for one file. */
export function projectFileHref(projectId: string, fileId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
}

const SHARED_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Nov 19, 2026" (UTC, so the server and the browser print the same). */
export function sharedDateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : SHARED_DATE.format(d);
}
