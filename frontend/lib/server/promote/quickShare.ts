// Rules for the "Share a file" screen (/share) and the download page.
// Pure (its only import is the pure mediaFiles.ts), so the browser component,
// the item page and `npm test` share them.

import { fileDownloadHref } from "./mediaFiles.ts";

/** The four choices on the screen and the item type each one is saved as. */
export const SHARE_KINDS = ["dataset", "slides", "tool", "other"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  dataset: "Dataset",
  slides: "Slides",
  tool: "Tool",
  other: "Other",
};

/** Item type stored for each choice. Slides are a "talk" item (shown as
 *  "Talk & slides" elsewhere on Promote). */
export const SHARE_KIND_TYPE: Record<ShareKind, "dataset" | "talk" | "tool" | "other"> = {
  dataset: "dataset",
  slides: "talk",
  tool: "tool",
  other: "other",
};

const SLIDES_EXTS = new Set(["pdf", "pptx"]);
const DATASET_EXTS = new Set(["csv", "tsv", "parquet", "xlsx", "json", "zip", "h5", "sdf"]);

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

/** The choice guessed from the first file's name. */
export function guessShareKind(filename: string): ShareKind {
  const ext = extensionOf(filename);
  if (SLIDES_EXTS.has(ext)) return "slides";
  if (DATASET_EXTS.has(ext)) return "dataset";
  return "other";
}

/** A filename without its extension, for a title. */
export function fileTitle(filename: string): string {
  const base = (filename.split(/[\\/]/).pop() ?? "").trim();
  const ext = extensionOf(base);
  const stem = ext ? base.slice(0, -(ext.length + 1)) : base;
  return stem.trim();
}

/** The title filled in for the person, which they can change:
 *    "Data for: <paper title>"    a dataset with a paper
 *    "Slides for: <paper title>"  slides with a paper
 *    the first filename without its extension, otherwise. */
export function prefillShareTitle(input: {
  kind: ShareKind;
  paperTitle: string | null | undefined;
  firstFileName: string | null | undefined;
}): string {
  const paper = (input.paperTitle ?? "").trim();
  if (paper && input.kind === "dataset") return `Data for: ${paper}`;
  if (paper && input.kind === "slides") return `Slides for: ${paper}`;
  return input.firstFileName ? fileTitle(input.firstFileName) : "";
}

/** One short line saying what still stops sharing, or null when nothing does.
 *  Checked in the order the screen reads: file, title, the tick box. */
export function missingBeforeShare(state: {
  filesReady: number;
  uploading: boolean;
  title: string;
  confirmed: boolean;
}): string | null {
  if (state.uploading) return "Wait for the upload to finish.";
  if (state.filesReady < 1) return "Add a file first.";
  if (!state.title.trim()) return "Add a title.";
  if (!state.confirmed) return "Tick the box to confirm you can share this file.";
  return null;
}

/** "Uploading 62%..." from bytes sent and total bytes. */
export function uploadingLabel(sent: number, total: number): string {
  const pct = total > 0 ? Math.min(99, Math.max(0, Math.floor((sent / total) * 100))) : 0;
  return `Uploading ${pct}%...`;
}

/** "Smith J, Lee K, Patel R et al." for the paper card. */
export function shortAuthors(authors: string[], max = 3): string {
  const list = authors.map((a) => a.trim()).filter(Boolean);
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} et al.`;
}

/** The year from a "YYYY", "YYYY-MM" or "YYYY-MM-DD" date, or "". */
export function paperYear(date: string | null | undefined): string {
  const m = /^(\d{4})/.exec((date ?? "").trim());
  return m ? m[1] : "";
}

/** The paper's year as stored on the item: a whole number between 1800 and
 *  2100, or null. Accepts a number or a "YYYY..." date string. */
export function cleanPaperYear(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(paperYear(typeof value === "string" ? value : ""));
  return Number.isInteger(n) && n >= 1800 && n <= 2100 ? n : null;
}

/** "Smith J, Lee K · Nature · 2025" — authors, journal, then year; parts that
 *  are missing are left out. Used by the paper card on the share screen and
 *  on the download page. */
export function paperDetailsLine(
  authors: string | null | undefined,
  journal: string | null | undefined,
  year: number | string | null | undefined
): string {
  return [authors, journal, year == null ? null : String(year)]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" · ");
}

/** The main button on a download page (an item with no body text): one file
 *  downloads it directly through its permanent link; several jump to the
 *  Files list. Null when there is no downloadable file. Never the paper. */
export function downloadButtonFor(
  slug: string,
  fileIds: string[]
): { label: string; href: string } | null {
  if (fileIds.length === 0) return null;
  if (fileIds.length === 1) {
    return { label: "Download file", href: fileDownloadHref(slug, fileIds[0]) };
  }
  return { label: "Download files", href: "#files" };
}

/** The choice shown for an item's stored type (the reverse of SHARE_KIND_TYPE).
 *  Any other type reads as Other. */
export function shareKindForType(type: string | null | undefined): ShareKind {
  if (type === "dataset") return "dataset";
  if (type === "talk") return "slides";
  if (type === "tool") return "tool";
  return "other";
}

/** A paper as the screens hold it. */
export type ScreenPaper = {
  title: string;
  authors: string[];
  journal: string | null;
  doi: string | null;
  publishedDate: string | null;
  sourceUrl: string;
};

/** What the save and share actions take for a paper, or null for none. */
export function paperForSave(paper: ScreenPaper | null): {
  title: string;
  authors: string[];
  journal: string | null;
  doi: string | null;
  link: string;
  year: number | null;
} | null {
  if (!paper) return null;
  return {
    title: paper.title,
    authors: paper.authors,
    journal: paper.journal,
    doi: paper.doi,
    link: paper.sourceUrl,
    year: cleanPaperYear(paper.publishedDate),
  };
}

/** The paper stored on an item, as the screens hold it, or null when the
 *  item has none (no title, or neither a doi nor a link). Authors are stored
 *  as one "A, B, C" string. */
export function paperFromStored(row: {
  title?: string | null;
  authors?: string | null;
  journal?: string | null;
  doi?: string | null;
  link?: string | null;
  paperYear?: number | null;
}): ScreenPaper | null {
  const title = (row.title ?? "").trim();
  const doi = (row.doi ?? "").trim() || null;
  const link = (row.link ?? "").trim() || (doi ? `https://doi.org/${doi}` : "");
  if (!title || !link) return null;
  return {
    title,
    authors: (row.authors ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    journal: (row.journal ?? "").trim() || null,
    doi,
    publishedDate: row.paperYear ? String(row.paperYear) : null,
    sourceUrl: link,
  };
}
