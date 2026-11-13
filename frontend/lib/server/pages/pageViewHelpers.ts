// lib/server/pages/pageViewHelpers.ts — pure helpers behind the /pages screens.
//
// The only runtime import is communityHome.ts, itself pure (type-only imports
// are erased), so `npm test` runs pageViewHelpers.test.ts under node --test
// and client components may import this file freely.

import type { ExploreItem, ExploreSection } from "../../../types/explore";
import { sourceName } from "../communityHome/communityHome.ts";

// ── visibility ───────────────────────────────────────────────────────────────

export type PageVisibility = "private" | "team" | "public";

export const VISIBILITY_INFO: Record<PageVisibility, { label: string; line: string }> = {
  private: { label: "Private", line: "Only the owner can see this page." },
  team: { label: "Team", line: "The owner and the team members they invite can see this page." },
  public: { label: "Public", line: "Anyone with the link can see this page, signed in or not." },
};

export function isVisibility(v: unknown): v is PageVisibility {
  return v === "private" || v === "team" || v === "public";
}

/** Shown when someone tries to add the page owner to the team. */
export const OWNER_ALREADY = "You already own this page.";

/** Is this the page owner, among accounts the owner could be invited as?
 *  Ids are compared only against ids of the SAME kind: `resolvedId` is the
 *  auth.users id the email lookup returned and `ownerId` is pages.owner_id,
 *  which RLS forces to equal the owner's auth.uid(). One person can have more
 *  than one auth identity for the same email (a different id from the lookup),
 *  so the owner's verified email is compared too. */
export function isOwnerAccount(args: {
  resolvedId: string | null;
  email: string;
  ownerId: string;
  ownerEmail: string | null;
}): boolean {
  if (args.resolvedId && args.resolvedId === args.ownerId) return true;
  const email = args.email.trim().toLowerCase();
  const ownerEmail = (args.ownerEmail ?? "").trim().toLowerCase();
  return email !== "" && email === ownerEmail;
}

// ── dates ────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" or an ISO timestamp -> "Oct 20" (plus the year when it is not
 *  `now`'s year). Parsed from the text, never through a local-time Date, so a
 *  date can't slip a day. Unparseable -> null. */
export function formatDay(value: string | null | undefined, now: Date = new Date()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  const day = Number(m[3]);
  return Number(m[1]) === now.getUTCFullYear() ? `${month} ${day}` : `${month} ${day}, ${m[1]}`;
}

// ── "What's new" ─────────────────────────────────────────────────────────────

export type UpdateRow = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  occurred_on: string; // YYYY-MM-DD
  /** page_evidence row this update announced (null once that row is pruned). */
  evidence_id?: string | null;
  created_at?: string;
};

const KIND_NOUN: Record<string, [string, string]> = {
  paper: ["paper", "papers"],
  preprint: ["preprint", "preprints"],
  trial: ["clinical trial", "clinical trials"],
  approval: ["FDA approval", "FDA approvals"],
  compound: ["compound", "compounds"],
  dataset: ["dataset", "datasets"],
  target: ["target", "targets"],
  geneset: ["gene set", "gene sets"],
  grant: ["grant", "grants"],
  tool: ["tool", "tools"],
  news: ["news item", "news items"],
};

export function kindNoun(kind: string, count: number): string {
  const pair = KIND_NOUN[kind];
  if (pair) return count === 1 ? pair[0] : pair[1];
  return count === 1 ? kind : `${kind}s`;
}

/** "3 new papers, 1 new FDA approval" — kinds in a stable order. */
export function summarizeKinds(rows: Pick<UpdateRow, "kind">[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const order = Object.keys(KIND_NOUN);
  const kinds = Array.from(counts.keys()).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return kinds.map((k) => `${counts.get(k)} new ${kindNoun(k, counts.get(k) ?? 0)}`).join(", ");
}

export type UpdateGroup = { date: string; label: string; headline: string; items: UpdateRow[] };

/** Updates grouped by occurred_on, newest day first (the input order inside a
 *  day is kept). */
export function groupUpdatesByDate(rows: UpdateRow[], now: Date = new Date()): UpdateGroup[] {
  const byDate = new Map<string, UpdateRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.occurred_on);
    if (list) list.push(r);
    else byDate.set(r.occurred_on, [r]);
  }
  return Array.from(byDate.keys())
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => {
      const items = byDate.get(date) as UpdateRow[];
      const label = formatDay(date, now) ?? date;
      return { date, label, headline: `${label}: ${summarizeKinds(items)}`, items };
    });
}

// ── "What's new" item rows ───────────────────────────────────────────────────

const UPDATE_CHIP: Record<string, string> = {
  paper: "Paper",
  preprint: "Preprint",
  trial: "Trial",
  approval: "FDA approval",
  dataset: "Dataset",
  compound: "Compound",
  target: "Target",
  grant: "Grant",
  tool: "Tool",
  news: "News",
};

/** The type chip before an item's title; any kind not listed reads "Source". */
export function updateChipLabel(kind: string): string {
  return UPDATE_CHIP[kind] ?? "Source";
}

/** The item's own date for the grey line: the year for papers and preprints
 *  ("2026"), month and year for everything else ("Nov 2026"). Read from the
 *  text (no local-time Date), so it can't slip across a month or year. */
export function updateItemDate(kind: string, dateIso: string | null | undefined): string | null {
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(dateIso ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  if (year <= 1970) return null; // epoch / placeholder
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  if (kind === "paper" || kind === "preprint" || !month) return m[1];
  return `${month} ${m[1]}`;
}

/** "PubMed · 2026", "ClinicalTrials.gov · Nov 2026", whichever half exists, or null. */
export function updateItemMeta(
  kind: string,
  source: string | null | undefined,
  dateIso: string | null | undefined
): string | null {
  const parts = [sourceName(source), updateItemDate(kind, dateIso)].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type WhatsNewItem = {
  id: string;
  kind: string;
  chip: string;
  title: string;
  url: string | null;
  meta: string | null;
  /** Items folded into this one (itself included); 1 for a plain item. */
  count: number;
  /** "(3 related datasets)" when count > 1, else null. */
  relatedLabel: string | null;
};

const TRAILING_BRACKET = /\s*\[[^\][]*\]\s*$/;

/** One day's update rows as display items. Rows of the same kind whose titles
 *  are identical apart from a trailing bracket ("... [ATAC-seq]", "...
 *  [ChIP-seq]") fold into one item that links to the first of them and shows
 *  the shared title. Source and date come from the row's own page_evidence
 *  entry (`evidenceById`), when it is still there. Order is kept. */
export function whatsNewItems(
  rows: UpdateRow[],
  evidenceById: Map<string, Pick<EvidenceRow, "source" | "date_iso">>
): WhatsNewItem[] {
  const out: WhatsNewItem[] = [];
  const byKey = new Map<string, { item: WhatsNewItem; bracketed: boolean }>();
  for (const r of rows) {
    const bracketed = TRAILING_BRACKET.test(r.title);
    const base = r.title.replace(TRAILING_BRACKET, "").trim();
    const key = `${r.kind}\u0000${base.toLowerCase()}`;
    const seen = base ? byKey.get(key) : undefined;
    if (seen && (bracketed || seen.bracketed)) {
      seen.item.count += 1;
      seen.item.title = base;
      seen.item.relatedLabel = `(${seen.item.count} related ${kindNoun(r.kind, seen.item.count)})`;
      seen.bracketed = true;
      continue;
    }
    const ev = r.evidence_id ? evidenceById.get(r.evidence_id) : undefined;
    const item: WhatsNewItem = {
      id: r.id,
      kind: r.kind,
      chip: updateChipLabel(r.kind),
      title: r.title,
      url: r.url,
      meta: updateItemMeta(r.kind, ev?.source, ev?.date_iso),
      count: 1,
      relatedLabel: null,
    };
    out.push(item);
    if (base && !seen) byKey.set(key, { item, bracketed });
  }
  return out;
}

/** How many sources the page had when it was first built: the evidence rows
 *  no refresh update announced. (The first build writes no page_updates, and
 *  every refresh-added item gets one that points at its evidence row.) */
export function initialSourceCount(
  evidenceIds: string[],
  updates: Pick<UpdateRow, "evidence_id">[]
): number {
  const announced = new Set(updates.map((u) => u.evidence_id).filter((id): id is string => !!id));
  return evidenceIds.filter((id) => !announced.has(id)).length;
}

/** "Page created Oct 20 with 12 sources" — the single line that stands for the
 *  first build at the bottom of What's new. */
export function creationLine(
  createdAt: string | null | undefined,
  sources: number,
  now: Date = new Date()
): string {
  const day = formatDay(createdAt, now);
  const when = day ? `Page created ${day}` : "Page created";
  if (sources <= 0) return when;
  return `${when} with ${sources} ${sources === 1 ? "source" : "sources"}`;
}

// ── notes with numbered citations ────────────────────────────────────────────

export type BodyPart =
  | { type: "text"; text: string }
  | { type: "cite"; n: number; itemId: string | null }
  | { type: "notelink"; title: string; slug: string | null };

/** The citation number a page_note_evidence rationale carries
 *  ("Cited as [3]", written by tools/page_agent.py), or null. */
export function citationNumber(rationale: string | null | undefined): number | null {
  const m = /^Cited as \[(\d+)\]/.exec(rationale ?? "");
  return m ? Number(m[1]) : null;
}

/** Splits a note body into paragraphs of text, [n] citations and [[Note
 *  Title]] links. `citeMap` maps a citation number to an evidence item id for
 *  THIS note; a number it doesn't know stays plain text rather than linking to
 *  the wrong thing. `noteSlugByTitle` is keyed by lower-cased title. */
export function parseNoteBody(
  body: string,
  citeMap: Map<number, string>,
  noteSlugByTitle: Map<string, string>
): BodyPart[][] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const parts: BodyPart[] = [];
      const re = /\[\[([^\]]+)\]\]|\[(\d+)\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(paragraph))) {
        if (m.index > last) parts.push({ type: "text", text: paragraph.slice(last, m.index) });
        if (m[1] !== undefined) {
          const title = m[1].trim();
          parts.push({ type: "notelink", title, slug: noteSlugByTitle.get(title.toLowerCase()) ?? null });
        } else {
          const n = Number(m[2]);
          const itemId = citeMap.get(n) ?? null;
          if (itemId) parts.push({ type: "cite", n, itemId });
          else parts.push({ type: "text", text: m[0] });
        }
        last = m.index + m[0].length;
      }
      if (last < paragraph.length) parts.push({ type: "text", text: paragraph.slice(last) });
      return parts;
    });
}

// ── "All sources" ────────────────────────────────────────────────────────────

export type EvidenceRow = {
  id: string;
  item_id: string;
  kind: string;
  title: string;
  summary: string | null;
  url: string | null;
  source: string;
  date_iso: string | null;
  signal_metric: string | null;
  signal_value: number | null;
  signal_as_of: string | null;
};

export function evidenceToItem(row: EvidenceRow): ExploreItem {
  return {
    id: row.item_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    source: row.source,
    date_iso: row.date_iso,
    signal:
      row.signal_metric && row.signal_value !== null
        ? { metric: row.signal_metric, value: row.signal_value, as_of: row.signal_as_of ?? "" }
        : null,
  };
}

// Papers first, then the order the Explore chips use.
export const KIND_ORDER = [
  "paper", "preprint", "dataset", "trial", "approval", "compound", "target",
  "geneset", "tool", "grant", "news",
];

/** page_evidence grouped by kind into Explore sections (so the existing
 *  Explore lists and tiles render them), in KIND_ORDER, unknown kinds last. */
export function groupEvidenceByKind(rows: EvidenceRow[]): ExploreSection[] {
  const byKind = new Map<string, ExploreItem[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind);
    const item = evidenceToItem(row);
    if (list) list.push(item);
    else byKind.set(row.kind, [item]);
  }
  const rank = (k: string) => {
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return Array.from(byKind.keys())
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((kind) => ({ tool: `page-${kind}`, kind, items: byKind.get(kind) as ExploreItem[] }));
}

// ── tabs on a wiki page ──────────────────────────────────────────────────────
// /pages/<slug>?tab=<key>. The page is rendered on the server one tab at a time.

export const WIKI_TABS = [
  { key: "new", label: "What's new" },
  { key: "papers", label: "Papers" },
  { key: "datasets", label: "Datasets" },
  { key: "background", label: "Background" },
  { key: "other", label: "More sources" },
] as const;
export type WikiTab = (typeof WIKI_TABS)[number]["key"];

export function isWikiTab(v: unknown): v is WikiTab {
  return WIKI_TABS.some((t) => t.key === v);
}

/** One plain sentence for a tab with nothing in it. Background keeps the
 *  sections' own empty state (components/pages/PageNotes.tsx). */
export const WIKI_TAB_EMPTY: Record<Exclude<WikiTab, "background">, string> = {
  new: "Nothing new yet. New papers, trials and datasets are added about once a day.",
  papers: "No papers collected yet.",
  datasets: "No datasets found for this topic yet. Datasets come from GEO.",
  other: "No other sources yet.",
};

/** The tab a collected item is shown on: papers and preprints on Papers,
 *  datasets on Datasets, every other kind on More sources. */
export function tabOfKind(kind: string): "papers" | "datasets" | "other" {
  if (kind === "paper" || kind === "preprint") return "papers";
  if (kind === "dataset") return "datasets";
  return "other";
}

/** The collected items of each source tab, in the order they came. */
export function splitEvidenceByTab<T extends { kind: string }>(rows: T[]): { papers: T[]; datasets: T[]; other: T[] } {
  const out: { papers: T[]; datasets: T[]; other: T[] } = { papers: [], datasets: [], other: [] };
  for (const row of rows) out[tabOfKind(row.kind)].push(row);
  return out;
}

/** The number shown on each tab: timeline entries, items per source tab, sections. */
export function wikiTabCounts(v: { updates: number; evidence: { kind: string }[]; notes: number }): Record<WikiTab, number> {
  const split = splitEvidenceByTab(v.evidence);
  return {
    new: v.updates,
    papers: split.papers.length,
    datasets: split.datasets.length,
    background: v.notes,
    other: split.other.length,
  };
}

/** Which tab the page shows. A valid ?tab= wins. Without one: the viewer's
 *  saved choice (the wiki_tab cookie) when it is one of the tabs; else What's
 *  new when it has at least one entry; else Background. */
export function pickWikiTab(v: { param: unknown; saved: unknown; newCount: number }): WikiTab {
  if (isWikiTab(v.param)) return v.param;
  if (isWikiTab(v.saved)) return v.saved;
  return v.newCount > 0 ? "new" : "background";
}

export function wikiTabHref(slug: string, tab: WikiTab): string {
  return `/pages/${slug}?tab=${tab}`;
}

/** The cookie that remembers "Always open on": a year, the whole site, Lax. */
export const WIKI_TAB_COOKIE = "wiki_tab";
export const WIKI_TAB_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function wikiTabCookie(tab: WikiTab): string {
  return `${WIKI_TAB_COOKIE}=${tab}; Max-Age=${WIKI_TAB_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

/** The id a collected item carries in the Papers, Datasets and More sources
 *  lists, so a citation can scroll to it. Made from the item's source id (the
 *  id the Explore lists get); anything but letters, digits, _ and - becomes -. */
export function sourceAnchor(itemId: string): string {
  return `src-${itemId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/** Where a citation [n] goes: the tab that holds its source, scrolled to it. */
export function citationHref(slug: string, item: { kind: string; item_id: string }): string {
  return `${wikiTabHref(slug, tabOfKind(item.kind))}#${sourceAnchor(item.item_id)}`;
}

// ── my pages ─────────────────────────────────────────────────────────────────

export const NEW_ITEMS_WINDOW_DAYS = 7;

export function newItemsCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - NEW_ITEMS_WINDOW_DAYS * 24 * 3600_000).toISOString();
}
