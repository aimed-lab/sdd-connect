// Where an item lives. Pure (its only import is the pure shareText.ts), so
// pages, client components and `npm test` share one answer.
//
// Two kinds of item share one table (promote_showcase):
//   - a normal Promote post (news: a paper, a talk, an award...) lives at
//     /promote/<slug>;
//   - a FILE SHARE (made on /share; promote_showcase.is_file_share = true)
//     lives at /files/<slug>.
// Each address redirects to the other when it is asked for the wrong kind.
// A file's permanent download link is /files/<slug>/download/<mediaId> for
// either kind; the older /promote/<slug>/files/<mediaId> redirects to it.

import { articleUrlFor } from "./shareText.ts";

export type ItemArea = "promote" | "files";

export function itemArea(isFileShare: boolean): ItemArea {
  return isFileShare ? "files" : "promote";
}

/** The item's page, as a path: /files/<slug> or /promote/<slug>. */
export function itemPath(slug: string, isFileShare: boolean): string {
  return `/${itemArea(isFileShare)}/${slug}`;
}

/** The owner's edit page: /files/<slug>/edit or /promote/<slug>/edit. */
export function itemEditPath(slug: string, isFileShare: boolean): string {
  return `${itemPath(slug, isFileShare)}/edit`;
}

/** The item's full public address on the configured site (for the share
 *  buttons, Copy link, the QR code, og:url and the canonical). */
export function itemUrlFor(base: string, slug: string, isFileShare: boolean): string {
  if (!isFileShare) return articleUrlFor(base, slug);
  return `${base.replace(/\/+$/, "")}/files/${slug}`;
}

/** The 1200x630 link preview card's path, under the item's own address. */
export function itemCardImagePath(slug: string, isFileShare: boolean): string {
  return `${itemPath(slug, isFileShare)}/opengraph-image`;
}

/** The card's full address on the configured site. */
export function itemCardImageUrlFor(base: string, slug: string, isFileShare: boolean): string {
  return `${itemUrlFor(base, slug, isFileShare)}/opengraph-image`;
}

/** The redirect for an item page asked for under the wrong area, or null
 *  when the area is right. `route` is the area the request came in on. */
export function itemPageRedirect(route: ItemArea, slug: string, isFileShare: boolean): string | null {
  return route === itemArea(isFileShare) ? null : itemPath(slug, isFileShare);
}

/** Same rule for the edit page. */
export function editPageRedirect(route: ItemArea, slug: string, isFileShare: boolean): string | null {
  return route === itemArea(isFileShare) ? null : itemEditPath(slug, isFileShare);
}

/** Where a page goes after its item is deleted. */
export function afterDeletePath(isFileShare: boolean): string {
  return isFileShare ? "/files?deleted=1" : "/promote?deleted=1";
}

// ── list rules ───────────────────────────────────────────────────────────────

type ListRow = { published: boolean; is_file_share?: boolean | null; owner_id?: string | null };

/** The Promote feed and its filters: published posts that are not file shares. */
export function listedOnPromote(row: ListRow): boolean {
  return row.published === true && row.is_file_share !== true;
}

/** "Recently shared" on /files: everyone's published file shares. */
export function listedInRecentlyShared(row: ListRow): boolean {
  return row.published === true && row.is_file_share === true;
}

/** "Your files" on /files: the viewer's own file shares, published or not. */
export function listedInYourFiles(row: ListRow, viewerId: string | null | undefined): boolean {
  return Boolean(viewerId) && row.is_file_share === true && row.owner_id === viewerId;
}

/** The paper a file share is linked to, by title, or null when it has none.
 *  A share with a paper stores the paper's title in `title` and its doi or
 *  link next to it (lib/server/showcase.ts: shareFileItem). */
export function linkedPaperTitle(row: {
  title?: string | null;
  doi?: string | null;
  link?: string | null;
}): string | null {
  const title = (row.title ?? "").trim();
  if (!title) return null;
  return (row.doi ?? "").trim() || (row.link ?? "").trim() ? title : null;
}

/** The plain name of a file share's type, as the share screen calls it. */
export function fileShareTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "dataset":
      return "Dataset";
    case "talk":
      return "Slides";
    case "tool":
      return "Tool";
    default:
      return "Other";
  }
}
