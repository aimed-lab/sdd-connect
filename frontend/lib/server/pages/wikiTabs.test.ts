// Run with `npm test`. The tabs of a wiki page (/pages/<slug>?tab=): the list,
// which tab opens, what each tab holds, the counts, the saved-choice cookie and
// where a citation goes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WIKI_TABS,
  WIKI_TAB_COOKIE,
  WIKI_TAB_EMPTY,
  citationHref,
  isWikiTab,
  pickWikiTab,
  sourceAnchor,
  splitEvidenceByTab,
  tabOfKind,
  wikiTabCookie,
  wikiTabCounts,
  wikiTabHref,
} from "./pageViewHelpers.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("the five tabs, in order, with their names", () => {
  assert.deepEqual(WIKI_TABS.map((t) => [t.key, t.label]), [
    ["new", "What's new"],
    ["papers", "Papers"],
    ["datasets", "Datasets"],
    ["background", "Background"],
    ["other", "More sources"],
  ]);
  for (const t of WIKI_TABS) assert.equal(isWikiTab(t.key), true);
  for (const bad of ["notes", "past", "New", "", null, undefined, 3, ["new"]]) assert.equal(isWikiTab(bad), false, String(bad));
});

test("which tab opens: ?tab= wins when it is one of the tabs", () => {
  assert.equal(pickWikiTab({ param: "datasets", saved: "papers", newCount: 4 }), "datasets");
  assert.equal(pickWikiTab({ param: "other", saved: null, newCount: 0 }), "other");
  // An unknown ?tab= is ignored, not an error.
  assert.equal(pickWikiTab({ param: "nonsense", saved: "papers", newCount: 4 }), "papers");
});

test("which tab opens with no ?tab=: the saved choice, if that tab exists", () => {
  assert.equal(pickWikiTab({ param: undefined, saved: "papers", newCount: 4 }), "papers");
  assert.equal(pickWikiTab({ param: undefined, saved: "background", newCount: 4 }), "background");
  // A saved choice is used even when that tab is empty: it is what the viewer asked for.
  assert.equal(pickWikiTab({ param: undefined, saved: "new", newCount: 0 }), "new");
  // A saved value that is not a tab (an old or edited cookie) is ignored.
  assert.equal(pickWikiTab({ param: undefined, saved: "notes", newCount: 4 }), "new");
  assert.equal(pickWikiTab({ param: undefined, saved: "notes", newCount: 0 }), "background");
});

test("which tab opens with no ?tab= and nothing saved: What's new if it has an entry, else Background", () => {
  assert.equal(pickWikiTab({ param: undefined, saved: null, newCount: 1 }), "new");
  assert.equal(pickWikiTab({ param: undefined, saved: null, newCount: 12 }), "new");
  assert.equal(pickWikiTab({ param: undefined, saved: null, newCount: 0 }), "background");
  assert.equal(pickWikiTab({ param: undefined, saved: undefined, newCount: 0 }), "background");
});

test("tabOfKind: papers and preprints, datasets, and every other kind on More sources", () => {
  assert.equal(tabOfKind("paper"), "papers");
  assert.equal(tabOfKind("preprint"), "papers");
  assert.equal(tabOfKind("dataset"), "datasets");
  for (const k of ["trial", "approval", "compound", "target", "geneset", "tool", "grant", "news", "resource", "person", "something-new"]) {
    assert.equal(tabOfKind(k), "other", k);
  }
});

const EVIDENCE = [
  { id: "1", kind: "paper" },
  { id: "2", kind: "trial" },
  { id: "3", kind: "preprint" },
  { id: "4", kind: "dataset" },
  { id: "5", kind: "geneset" },
  { id: "6", kind: "paper" },
  { id: "7", kind: "approval" },
];

test("splitEvidenceByTab: every item is on exactly one tab, order kept", () => {
  const s = splitEvidenceByTab(EVIDENCE);
  assert.deepEqual(s.papers.map((r) => r.id), ["1", "3", "6"]);
  assert.deepEqual(s.datasets.map((r) => r.id), ["4"]);
  assert.deepEqual(s.other.map((r) => r.id), ["2", "5", "7"]);
  assert.equal(s.papers.length + s.datasets.length + s.other.length, EVIDENCE.length);
  assert.deepEqual(splitEvidenceByTab([]), { papers: [], datasets: [], other: [] });
});

test("wikiTabCounts: timeline entries, items per source tab, sections", () => {
  assert.deepEqual(wikiTabCounts({ updates: 9, evidence: EVIDENCE, notes: 4 }), { new: 9, papers: 3, datasets: 1, background: 4, other: 3 });
  assert.deepEqual(wikiTabCounts({ updates: 0, evidence: [], notes: 0 }), { new: 0, papers: 0, datasets: 0, background: 0, other: 0 });
});

test("empty states: one plain sentence each", () => {
  assert.equal(WIKI_TAB_EMPTY.new, "Nothing new yet. New papers, trials and datasets are added about once a day.");
  assert.equal(WIKI_TAB_EMPTY.papers, "No papers collected yet.");
  assert.equal(WIKI_TAB_EMPTY.datasets, "No datasets found for this topic yet. Datasets come from GEO.");
  assert.equal(WIKI_TAB_EMPTY.other, "No other sources yet.");
});

test("the saved choice: cookie wiki_tab, one year, the whole site, SameSite=Lax", () => {
  assert.equal(WIKI_TAB_COOKIE, "wiki_tab");
  assert.equal(wikiTabCookie("papers"), "wiki_tab=papers; Max-Age=31536000; Path=/; SameSite=Lax");
  assert.equal(wikiTabHref("kras-ab12", "datasets"), "/pages/kras-ab12?tab=datasets");
});

test("a citation opens the tab that holds its source and scrolls to it", () => {
  assert.equal(sourceAnchor("pmid:12345"), "src-pmid-12345");
  assert.equal(sourceAnchor("10.1038/s41586-020-1"), "src-10-1038-s41586-020-1");
  assert.match(sourceAnchor("geo:GSE1 (x)/y?z#"), /^src-[A-Za-z0-9_-]+$/);
  assert.equal(citationHref("kras-ab12", { kind: "paper", item_id: "pmid:1" }), "/pages/kras-ab12?tab=papers#src-pmid-1");
  assert.equal(citationHref("kras-ab12", { kind: "preprint", item_id: "ppr:2" }), "/pages/kras-ab12?tab=papers#src-ppr-2");
  assert.equal(citationHref("kras-ab12", { kind: "dataset", item_id: "geo:GSE3" }), "/pages/kras-ab12?tab=datasets#src-geo-GSE3");
  assert.equal(citationHref("kras-ab12", { kind: "trial", item_id: "NCT04" }), "/pages/kras-ab12?tab=other#src-NCT04");
});

test("the lists give every item the id a citation points at", () => {
  // Same helper on both sides, so the link and the target cannot drift apart.
  assert.match(read("components/explore/PaperList.tsx"), /id=\{anchors \? sourceAnchor\(item\.id\) : undefined\}/);
  assert.match(read("components/explore/OtherSections.tsx"), /id=\{sourceAnchor\(item\.id\)\}/);
  const sources = read("components/pages/PageSources.tsx");
  assert.equal(sources.split(" anchors").length - 1, 4, "both paper lists, datasets and More sources");
  // Gene sets are open on a wiki page, so a cited gene set is on the page to scroll to.
  assert.match(sources, /expandGenesets hideSave anchors/);
  assert.match(read("components/pages/PageNotes.tsx"), /href=\{citationHref\(pageSlug, item\)\}/);
});

test("the page: tabs from ?tab= and the cookie, settings behind a button, the new intro line", () => {
  const page = read("app/pages/[slug]/page.tsx");
  assert.match(page, /cookies\(\)\)\.get\(WIKI_TAB_COOKIE\)/);
  assert.match(page, /pickWikiTab\(\{ param: .*saved, newCount: counts\.new \}\)/);
  assert.match(page, /Everything on this topic in one place\. Pick the tab for what you need\./);
  assert.ok(!page.includes("This page updates itself with new research"));
  assert.match(page, /<PageActions title=\{page\.title\} settings=\{settings\} \/>/);
  // The controls are only ever rendered inside the settings value.
  const body = page.slice(page.lastIndexOf("return ("));
  assert.ok(!body.includes("<PageControls") && !body.includes("<TeamPanel"));

  const tabs = read("components/pages/PageTabs.tsx");
  assert.match(tabs, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(tabs, /min-h-11/);
  assert.match(tabs, /overflow-x-auto/);
  assert.match(tabs, /document\.cookie = wikiTabCookie\(value\)/);
  assert.match(tabs, /Always open on/);

  const actions = read("components/pages/PageActions.tsx");
  assert.match(actions, /Page settings/);
  assert.match(actions, /\{settings && \(\s*<button/);
});
