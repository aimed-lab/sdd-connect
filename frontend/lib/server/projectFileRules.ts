// lib/server/projectFileRules.ts — the rules for files shared inside a project
// (public.project_files, database/migrations/2026-11-19_project_files*.sql),
// as pure functions: the path an upload goes to, which files are accepted,
// the content type sent to Storage, the icon a file gets and who may remove
// it. No I/O, no next/* imports, so `npm test` runs it with plain node and the
// browser uploader (components/projects/workspace/ProjectFilesSection.tsx)
// can import it as well as lib/server/projectFiles.ts.

import { buildMediaObjectPath, displayFileName, fileExtension, isMediaObjectPathFor } from "./promote/mediaFiles.ts";

export const PROJECT_FILES_BUCKET = "project-files";

/** 50 MB, the bucket's own file_size_limit. */
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;

export type ProjectFileKind = "image" | "pdf" | "slides" | "document" | "spreadsheet";

type TypeRule = { kind: ProjectFileKind; contentType: string; alsoReported: string[] };

// Accepted extensions, the standard content type each one is uploaded with,
// and the other types browsers are known to report for it. Office files are
// reported inconsistently (e.g. "application/vnd.ms-office", or a zip type for
// the newer formats on some systems), so the extension decides and the
// reported type only has to be one of these, or empty / generic.
const OOXML_ZIP = ["application/zip", "application/x-zip-compressed", "application/x-zip"];
const MS_OFFICE = ["application/vnd.ms-office", "application/x-ole-storage", "application/cdfv2"];

const RULES: Record<string, TypeRule> = {
  png: { kind: "image", contentType: "image/png", alsoReported: [] },
  jpg: { kind: "image", contentType: "image/jpeg", alsoReported: ["image/pjpeg", "image/jpg"] },
  jpeg: { kind: "image", contentType: "image/jpeg", alsoReported: ["image/pjpeg", "image/jpg"] },
  gif: { kind: "image", contentType: "image/gif", alsoReported: [] },
  webp: { kind: "image", contentType: "image/webp", alsoReported: [] },
  pdf: { kind: "pdf", contentType: "application/pdf", alsoReported: ["application/x-pdf", "application/acrobat"] },
  ppt: {
    kind: "slides",
    contentType: "application/vnd.ms-powerpoint",
    alsoReported: ["application/mspowerpoint", "application/powerpoint", "application/x-mspowerpoint", ...MS_OFFICE],
  },
  pptx: {
    kind: "slides",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    alsoReported: ["application/vnd.ms-powerpoint", ...OOXML_ZIP, ...MS_OFFICE],
  },
  doc: {
    kind: "document",
    contentType: "application/msword",
    alsoReported: ["application/x-msword", "application/doc", ...MS_OFFICE],
  },
  docx: {
    kind: "document",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    alsoReported: ["application/msword", ...OOXML_ZIP, ...MS_OFFICE],
  },
  xls: {
    kind: "spreadsheet",
    contentType: "application/vnd.ms-excel",
    alsoReported: ["application/excel", "application/x-excel", "application/x-msexcel", ...MS_OFFICE],
  },
  xlsx: {
    kind: "spreadsheet",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    alsoReported: ["application/vnd.ms-excel", ...OOXML_ZIP, ...MS_OFFICE],
  },
};

/** Reported types that say nothing about the file. */
const GENERIC = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

/** The file picker's `accept`: extensions and the standard types. */
export const PROJECT_FILE_ACCEPT = [
  ...Object.keys(RULES).map((ext) => `.${ext}`),
  ...Array.from(new Set(Object.values(RULES).map((r) => r.contentType))),
].join(",");

export const PROJECT_FILE_TYPES_LABEL = "Images, PDF, PowerPoint, Word or Excel";

export type FileTypeCheck =
  | { ok: true; kind: ProjectFileKind; contentType: string }
  | { ok: false; message: string };

function normalType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/** Is this file accepted? The extension must be one of the allowed ones, and
 *  the type the browser (or Storage) reports must fit that extension, or be
 *  empty / generic. On success, `contentType` is the standard type for the
 *  extension: the one to upload with and the one Storage must report back. */
export function checkProjectFileType(filename: string, reportedType: string | null | undefined): FileTypeCheck {
  const name = displayFileName(filename);
  const rule = RULES[fileExtension(filename)];
  if (!rule) {
    return { ok: false, message: `"${name}" can't be shared here. Use ${PROJECT_FILE_TYPES_LABEL.toLowerCase()} files.` };
  }
  const type = normalType(reportedType);
  if (!GENERIC.has(type) && type !== rule.contentType && !rule.alsoReported.includes(type)) {
    return { ok: false, message: `"${name}" doesn't look like the kind of file its name says it is.` };
  }
  return { ok: true, kind: rule.kind, contentType: rule.contentType };
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
  return RULES[fileExtension(filename)]?.kind ?? "document";
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
