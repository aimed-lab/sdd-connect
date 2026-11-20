// lib/server/uploads/fileTypes.ts — which file types an upload accepts, decided
// by the EXTENSION, and the standard content type each one is uploaded with.
// Shared by project files (lib/server/projectFileRules.ts) and community / team
// files (lib/server/communityFileRules.ts). Pure: no I/O, no next/* imports, so
// `npm test` runs it and the browser uploaders can import it.
//
// WHY THE EXTENSION DECIDES: browsers report Office files inconsistently (an
// empty type, "application/octet-stream", a zip type for .pptx on some systems,
// "application/vnd.ms-office"...). A private bucket only accepts the exact types
// in its allowed list, so the uploader sends the STANDARD type for the extension,
// and the reported type only has to fit that extension (or say nothing).

import { fileExtension } from "../promote/mediaFiles.ts";

export type FileKind = "image" | "pdf" | "slides" | "document" | "spreadsheet";

type TypeRule = { kind: FileKind; contentType: string; alsoReported: string[] };

const OOXML_ZIP = ["application/zip", "application/x-zip-compressed", "application/x-zip"];
const MS_OFFICE = ["application/vnd.ms-office", "application/x-ole-storage", "application/cdfv2"];

/** Every extension any uploader here knows, with its standard content type and
 *  the other types browsers are known to report for it. Each feature picks the
 *  subset it accepts. */
export const FILE_TYPE_RULES: Record<string, TypeRule> = {
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

function normalType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

export type StandardTypeCheck =
  | { ok: true; ext: string; kind: FileKind; contentType: string }
  | { ok: false; reason: "extension" | "mismatch" };

/** Is this file one of `allowed` (extensions without the dot)? "extension": not
 *  an allowed extension (or none). "mismatch": the reported type contradicts
 *  the extension. On success, `contentType` is the standard type to upload with
 *  and the one Storage must report back. */
export function checkFileTypeFor(
  filename: string,
  reportedType: string | null | undefined,
  allowed: readonly string[]
): StandardTypeCheck {
  const ext = fileExtension(filename);
  const rule = allowed.includes(ext) ? FILE_TYPE_RULES[ext] : undefined;
  if (!rule) return { ok: false, reason: "extension" };
  const type = normalType(reportedType);
  if (!GENERIC.has(type) && type !== rule.contentType && !rule.alsoReported.includes(type)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, ext, kind: rule.kind, contentType: rule.contentType };
}

/** The content type to send to Storage: the standard one for an accepted file,
 *  else the generic binary type (which the bucket then refuses). */
export function standardContentType(
  filename: string,
  reportedType: string | null | undefined,
  allowed: readonly string[]
): string {
  const t = checkFileTypeFor(filename, reportedType, allowed);
  return t.ok ? t.contentType : "application/octet-stream";
}

/** A file picker's `accept`: the extensions, then their standard types. */
export function acceptListFor(allowed: readonly string[]): string {
  const known = allowed.filter((ext) => FILE_TYPE_RULES[ext]);
  return [
    ...known.map((ext) => `.${ext}`),
    ...Array.from(new Set(known.map((ext) => FILE_TYPE_RULES[ext].contentType))),
  ].join(",");
}

/** The standard content types of these extensions (a bucket's allowed list). */
export function contentTypesFor(allowed: readonly string[]): string[] {
  return Array.from(new Set(allowed.filter((ext) => FILE_TYPE_RULES[ext]).map((ext) => FILE_TYPE_RULES[ext].contentType)));
}
