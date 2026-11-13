// Run with `npm test` (node --test). Pure helpers behind the /pages screens.

import test from "node:test";
import assert from "node:assert/strict";
import {
  citationNumber,
  creationLine,
  formatDay,
  groupEvidenceByKind,
  groupUpdatesByDate,
  initialSourceCount,
  newItemsCutoffIso,
  parseNoteBody,
  summarizeKinds,
  updateChipLabel,
  updateItemDate,
  updateItemMeta,
  whatsNewItems,
  type EvidenceRow,
  type UpdateRow,
} from "./pageViewHelpers.ts";

const NOW = new Date("2026-10-20T12:00:00Z");

const upd = (id: string, kind: string, occurred_on: string): UpdateRow => ({
  id,
  kind,
  title: `T ${id}`,
  summary: null,
  url: `https://x/${id}`,
  occurred_on,
});

test("formatDay: no timezone drift, year only when it is not this year", () => {
  assert.equal(formatDay("2026-10-20", NOW), "Oct 20");
  assert.equal(formatDay("2026-10-20T23:59:59Z", NOW), "Oct 20");
  assert.equal(formatDay("2025-01-05", NOW), "Jan 5, 2025");
  assert.equal(formatDay(null, NOW), null);
  assert.equal(formatDay("nonsense", NOW), null);
});

test("summarizeKinds: counts with singular and plural nouns in a stable order", () => {
  assert.equal(
    summarizeKinds([{ kind: "approval" }, { kind: "paper" }, { kind: "paper" }, { kind: "paper" }]),
    "3 new papers, 1 new FDA approval"
  );
  assert.equal(summarizeKinds([{ kind: "trial" }, { kind: "trial" }]), "2 new clinical trials");
});

test("groupUpdatesByDate: newest day first, headline reads 'Oct 20: ...'", () => {
  const groups = groupUpdatesByDate(
    [
      upd("a", "paper", "2026-10-18"),
      upd("b", "paper", "2026-10-20"),
      upd("c", "paper", "2026-10-20"),
      upd("d", "paper", "2026-10-20"),
      upd("e", "approval", "2026-10-20"),
    ],
    NOW
  );
  assert.deepEqual(groups.map((g) => g.date), ["2026-10-20", "2026-10-18"]);
  assert.equal(groups[0].headline, "Oct 20: 3 new papers, 1 new FDA approval");
  assert.equal(groups[1].headline, "Oct 18: 1 new paper");
  assert.equal(groups[0].items.length, 4);
});

test("citationNumber: only the page agent's 'Cited as [n]' rationale counts", () => {
  assert.equal(citationNumber("Cited as [3]"), 3);
  assert.equal(citationNumber('Shares "kinase" with this note.'), null);
  assert.equal(citationNumber(null), null);
});

test("parseNoteBody: resolves known citations and note links, leaves unknown ones as text", () => {
  const paragraphs = parseNoteBody(
    "EGFR drives growth [1]. See [[Resistance]] and also [9].\n\nSecond paragraph [2].",
    new Map([[1, "ev-1"], [2, "ev-2"]]),
    new Map([["resistance", "resistance"]])
  );
  assert.equal(paragraphs.length, 2);
  assert.deepEqual(paragraphs[0].filter((p) => p.type === "cite"), [{ type: "cite", n: 1, itemId: "ev-1" }]);
  assert.deepEqual(paragraphs[0].filter((p) => p.type === "notelink"), [
    { type: "notelink", title: "Resistance", slug: "resistance" },
  ]);
  // [9] has no evidence for this note: stays literal text.
  assert.ok(paragraphs[0].some((p) => p.type === "text" && p.text.includes("[9]")));
  assert.deepEqual(paragraphs[1].filter((p) => p.type === "cite"), [{ type: "cite", n: 2, itemId: "ev-2" }]);
});

test("parseNoteBody: a link to a note that does not exist has no slug", () => {
  const [parts] = parseNoteBody("See [[Ghost]].", new Map(), new Map());
  assert.deepEqual(parts.filter((p) => p.type === "notelink"), [{ type: "notelink", title: "Ghost", slug: null }]);
});

test("groupEvidenceByKind: papers first, then Explore order, unknown kinds last", () => {
  const row = (item_id: string, kind: string): EvidenceRow => ({
    id: `id-${item_id}`,
    item_id,
    kind,
    title: item_id,
    summary: null,
    url: null,
    source: "s",
    date_iso: null,
    signal_metric: null,
    signal_value: null,
    signal_as_of: null,
  });
  const sections = groupEvidenceByKind([
    row("g", "grant"),
    row("x", "weird"),
    row("t", "trial"),
    row("p1", "paper"),
    row("p2", "paper"),
    row("a", "approval"),
  ]);
  assert.deepEqual(sections.map((s) => s.kind), ["paper", "trial", "approval", "grant", "weird"]);
  assert.deepEqual(sections[0].items.map((i) => i.id), ["p1", "p2"]);
});

test("newItemsCutoffIso: seven days back", () => {
  assert.equal(newItemsCutoffIso(NOW), "2026-10-13T12:00:00.000Z");
});

test("initialSourceCount: evidence no refresh update announced is the first build", () => {
  assert.equal(initialSourceCount(["e1", "e2", "e3", "e4"], [{ evidence_id: "e3" }, { evidence_id: null }, { evidence_id: "e4" }]), 2);
  assert.equal(initialSourceCount([], []), 0);
  assert.equal(initialSourceCount(["e1"], []), 1);
});

test("creationLine: 'Page created <date> with <N> sources'", () => {
  assert.equal(creationLine("2026-10-20T08:00:00Z", 12, NOW), "Page created Oct 20 with 12 sources");
  assert.equal(creationLine("2026-10-20T08:00:00Z", 1, NOW), "Page created Oct 20 with 1 source");
  assert.equal(creationLine("2026-10-20T08:00:00Z", 0, NOW), "Page created Oct 20");
  assert.equal(creationLine("2025-03-02T08:00:00Z", 3, NOW), "Page created Mar 2, 2025 with 3 sources");
  assert.equal(creationLine(null, 3, NOW), "Page created with 3 sources");
});

test("updateChipLabel: one label per known kind, 'Source' for anything else", () => {
  const want: Record<string, string> = {
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
  for (const [kind, label] of Object.entries(want)) assert.equal(updateChipLabel(kind), label, kind);
  for (const kind of ["geneset", "episode", "person", "", "Paper"]) assert.equal(updateChipLabel(kind), "Source", kind);
});

test("updateItemDate / updateItemMeta: year for papers, month and year otherwise, missing parts left out", () => {
  assert.equal(updateItemDate("paper", "2026-11-03"), "2026");
  assert.equal(updateItemDate("preprint", "2026-11-03T00:00:00Z"), "2026");
  assert.equal(updateItemDate("trial", "2026-11-03"), "Nov 2026");
  assert.equal(updateItemDate("dataset", "2025-01-31T23:59:59Z"), "Jan 2025");
  assert.equal(updateItemDate("trial", "2026"), "2026");
  assert.equal(updateItemDate("paper", null), null);
  assert.equal(updateItemDate("paper", "1970-01-01"), null);
  assert.equal(updateItemMeta("paper", "pubmed", "2026-05-01"), "PubMed · 2026");
  assert.equal(updateItemMeta("trial", "clinicaltrials", "2026-11-02"), "ClinicalTrials.gov · Nov 2026");
  assert.equal(updateItemMeta("dataset", "geo", null), "GEO");
  assert.equal(updateItemMeta("paper", null, "2024-03-01"), "2024");
  assert.equal(updateItemMeta("paper", "", null), null);
});

const row = (id: string, kind: string, title: string, evidence_id: string | null = null): UpdateRow => ({
  id,
  kind,
  title,
  summary: null,
  url: `https://x/${id}`,
  occurred_on: "2026-11-10",
  evidence_id,
});

test("whatsNewItems: chip and source/date from the linked evidence row", () => {
  const items = whatsNewItems(
    [row("a", "paper", "A paper", "ev-a"), row("b", "trial", "A trial", "ev-gone"), row("c", "geneset", "Genes")],
    new Map([["ev-a", { source: "pubmed", date_iso: "2026-02-01" }]])
  );
  assert.deepEqual(
    items.map((i) => [i.chip, i.title, i.meta, i.relatedLabel]),
    [
      ["Paper", "A paper", "PubMed · 2026", null],
      ["Trial", "A trial", null, null],
      ["Source", "Genes", null, null],
    ]
  );
});

test("whatsNewItems: titles differing only by a trailing bracket fold into one, linking to the first", () => {
  const items = whatsNewItems(
    [
      row("p", "paper", "Unrelated paper"),
      row("d1", "dataset", "Ovarian tumour atlas [ATAC-seq]", "ev-d1"),
      row("d2", "dataset", "Ovarian tumour atlas [ChIP-seq]"),
      row("d3", "dataset", "Ovarian tumour atlas [RNA-seq]"),
      row("e", "dataset", "Another atlas [ATAC-seq]"),
    ],
    new Map([["ev-d1", { source: "geo", date_iso: "2026-10-01" }]])
  );
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.id), ["p", "d1", "e"]);
  const folded = items[1];
  assert.equal(folded.title, "Ovarian tumour atlas");
  assert.equal(folded.url, "https://x/d1");
  assert.equal(folded.count, 3);
  assert.equal(folded.relatedLabel, "(3 related datasets)");
  assert.equal(folded.meta, "GEO · Oct 2026");
  // A lone bracketed title is left as it is.
  assert.equal(items[2].title, "Another atlas [ATAC-seq]");
  assert.equal(items[2].relatedLabel, null);
});

test("whatsNewItems: no fold across kinds, nor for different titles or a bracket mid-title", () => {
  const items = whatsNewItems(
    [
      row("a", "dataset", "Atlas [ATAC-seq]"),
      row("b", "paper", "Atlas [ChIP-seq]"),
      row("c", "dataset", "Atlas two [ChIP-seq]"),
      row("d", "dataset", "[Review] Atlas"),
    ],
    new Map()
  );
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.count === 1 && i.relatedLabel === null));
});

test("whatsNewItems: a plain title and its bracketed variant fold; two plain duplicates do not", () => {
  const folded = whatsNewItems([row("a", "dataset", "Atlas"), row("b", "dataset", "Atlas [ATAC-seq]")], new Map());
  assert.equal(folded.length, 1);
  assert.equal(folded[0].relatedLabel, "(2 related datasets)");
  const plain = whatsNewItems([row("a", "paper", "Same"), row("b", "paper", "Same")], new Map());
  assert.equal(plain.length, 2);
});
