// Pure helpers for files attached to a Promote item (promote_showcase_media).
//
// No imports and no I/O, on purpose: the browser uploader
// (components/promote/MediaUploader.tsx), the server action that records an
// upload (lib/server/showcase.ts:recordShowcaseMedia), the item page and the
// permanent download route all share these, and `npm test` runs them with
// plain node. Keeping it import-free is what makes it safe for a client
// component to import from lib/server/ (same as qrCode.ts / shareText.ts).

/** The one size limit for an attached file. Used by the uploader's message
 *  (before any upload starts) and by the server check after upload. Keep it
 *  at or below the showcase-media bucket's own size limit in the Supabase
 *  dashboard, or the bucket refuses the upload first with a vaguer error. */
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB

/** Longest label a file can have. Matches the CHECK constraint in
 *  database/migrations/2026-11-13_promote_files.sql. */
export const MAX_MEDIA_LABEL_CHARS = 200;

/** Longest stored (display) filename. */
export const MAX_MEDIA_FILENAME_CHARS = 200;

export type MediaFileKind = "image" | "slides" | "file";

// Only these four render inline as an <img> on the item page. Any other image
// type (SVG, TIFF, HEIC...) is treated as a plain file and only downloaded.
const IMAGE_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true,
  "image/gif": true,
};
const SLIDES_TYPES: Record<string, true> = {
  "application/pdf": true,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": true, // .pptx
};
const IMAGE_EXTS: Record<string, true> = { png: true, jpg: true, jpeg: true, webp: true, gif: true };
const SLIDES_EXTS: Record<string, true> = { pdf: true, pptx: true };

/** The lowercase extension of a filename without the dot, or "" when none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/** Which kind a file is stored as. The content type decides when it is a
 *  real one; an empty or generic type ("application/octet-stream", which is
 *  what browsers send for most unknown files) falls back to the extension. */
export function mediaKindFor(contentType: string | null | undefined, filename: string): MediaFileKind {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES[ct]) return "image";
  if (SLIDES_TYPES[ct]) return "slides";
  if (ct && ct !== "application/octet-stream") return "file";
  const ext = fileExtension(filename);
  if (IMAGE_EXTS[ext]) return "image";
  if (SLIDES_EXTS[ext]) return "slides";
  return "file";
}

/** The content type to send with an upload: the browser's, or the generic
 *  binary type when the browser doesn't know (e.g. .parquet). */
export function uploadContentType(browserType: string | null | undefined): string {
  const ct = (browserType ?? "").trim();
  return ct || "application/octet-stream";
}

/** A filename made safe to use inside a storage object path: ASCII letters,
 *  digits, dot, dash and underscore only, no leading dots, at most 100
 *  characters with the extension kept. Never empty. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const rawExt = fileExtension(base);
  const rawStem = rawExt ? base.slice(0, -(rawExt.length + 1)) : base;
  const part = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // drop accents: é -> e
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[.\-_]+/, "")
      .replace(/[.\-_]+$/, "");
  const ext = part(rawExt).replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const MAX = 100;
  const stemMax = ext ? MAX - ext.length - 1 : MAX;
  const stem = part(rawStem).slice(0, stemMax).replace(/[.\-_]+$/, "") || "file";
  return ext ? `${stem}.${ext}` : stem;
}

/** The filename people see and download under: the original name, minus any
 *  folder part, control characters and quotes, trimmed to the column limit. */
export function displayFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, MAX_MEDIA_FILENAME_CHARS).trim() || "file";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** The storage path for a new upload: `<showcase_id>/<uuid>-<clean name>`.
 *  The item's id stays the first folder, which is what the bucket's
 *  policies key on (only the item's owner may write there; readers need the
 *  item published or to own it). */
export function buildMediaObjectPath(showcaseId: string, fileId: string, filename: string): string {
  return `${showcaseId}/${fileId}-${cleanFileName(filename)}`;
}

/** True only for a path buildMediaObjectPath could have produced for THIS
 *  item. The server checks this before trusting a path the browser reports. */
export function isMediaObjectPathFor(path: string, showcaseId: string): boolean {
  if (!isUuid(showcaseId)) return false;
  const prefix = `${showcaseId.toLowerCase()}/`;
  if (!path.toLowerCase().startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([A-Za-z0-9._-]{1,100})$/i.exec(rest);
  if (!m) return false;
  return cleanFileName(m[2]) === m[2];
}

/** A label as stored: one line, single spaces, at most 200 characters, or
 *  null when empty. */
export function cleanMediaLabel(raw: string | null | undefined): string | null {
  const one = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!one) return null;
  return one.slice(0, MAX_MEDIA_LABEL_CHARS).trim();
}

/** "12.3 MB", "640 KB", "512 bytes". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** The plain message for a file over the limit, or null when it fits. */
export function fileTooLargeMessage(name: string, sizeBytes: number, maxBytes: number = MAX_MEDIA_BYTES): string | null {
  if (sizeBytes <= maxBytes) return null;
  return `"${displayFileName(name)}" is too large (${formatFileSize(sizeBytes)}). Files can be up to ${formatFileSize(maxBytes)}.`;
}

/** The permanent download link for one file on a published item (a file
 *  share or a Promote post): /files/<slug>/download/<mediaId>. Relative, so
 *  it works on any host the page is served from. */
export function fileDownloadHref(slug: string, mediaId: string): string {
  return `/files/${encodeURIComponent(slug)}/download/${encodeURIComponent(mediaId)}`;
}

/** The older download address, /promote/<slug>/files/<mediaId>. Still
 *  answered, by a redirect to fileDownloadHref, so links already sent work. */
export function legacyFileDownloadHref(slug: string, mediaId: string): string {
  return `/promote/${encodeURIComponent(slug)}/files/${encodeURIComponent(mediaId)}`;
}
