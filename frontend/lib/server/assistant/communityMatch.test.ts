// Run with `npm test`. Community search ranking and the match-card rules.

import test from "node:test";
import assert from "node:assert/strict";
import {
  matchAction,
  matchCommunityList,
  matchReason,
  pickPeopleMatch,
  queryTokens,
  rankCommunities,
  MATCH_LIMIT,
  MATCH_MIN_COVERAGE,
  TOPIC_SYNONYMS,
} from "./communityMatch.ts";
import { visibleCommunities } from "../communityVisibility.ts";

const c = (name: string, description: string | null, topics: string[] = []) => ({ name, description, explore_topics: topics });

const PANC = c("Pancreatic Cancer Research", "Basic and translational work on pancreatic cancer.", ["pancreatic ductal adenocarcinoma", "KRAS"]);
const KRAS = c("KRAS Drug Discovery", "Targeting KRAS across tumour types.", ["KRAS inhibitors"]);
const GENERIC = c("Cancer Patients Network", "Support for cancer patients and families.", []);
const LUNG = c("Lung Cancer Genomics", "Lung cancer mutations.", ["EGFR"]);
// Alphabetical, as listCommunities() returns them.
const ALL = [GENERIC, KRAS, LUNG, PANC];

test("queryTokens: drops short words and generic science filler, keeps the user's spelling", () => {
  assert.deepEqual(queryTokens("KRAS in the pancreatic cancer signaling").map((t) => t.shown), ["KRAS", "pancreatic", "cancer"]);
  assert.deepEqual(queryTokens("of an to"), []);
  assert.deepEqual(queryTokens("kras KRAS Kras").map((t) => t.shown), ["kras"], "duplicates count once");
});

test("a name/purpose/topic match ranks above a weak single-word hit", () => {
  const ranked = rankCommunities("pancreatic cancer KRAS", ALL).map((r) => r.community.name);
  assert.equal(ranked[0], "Pancreatic Cancer Research");
  // "Cancer Patients Network" and "Lung Cancer Genomics" only share the word cancer: they trail.
  assert.ok(ranked.indexOf("KRAS Drug Discovery") < ranked.indexOf("Cancer Patients Network"));
  assert.ok(ranked.indexOf("KRAS Drug Discovery") < ranked.indexOf("Lung Cancer Genomics"));
});

test("a word in the name outweighs the same word only in the purpose", () => {
  const inName = c("KRAS Biology", null);
  const inPurpose = c("Oncology Group", "We study KRAS signalling.");
  const ranked = rankCommunities("KRAS", [inPurpose, inName]);
  assert.equal(ranked[0].community, inName);
});

test("words side by side in the query and in the community earn a phrase bonus", () => {
  const together = c("Pancreatic Cancer Group", null);
  const apart = c("Cancer Genomics", "A group studying pancreatic islets.");
  const [first, second] = rankCommunities("pancreatic cancer", [apart, together]);
  assert.equal(first.community, together);
  assert.ok(first.score > second.score);
});

test("why it matched: the phrase first, then the remaining words, in the user's spelling", () => {
  const [top] = rankCommunities("pancreatic cancer KRAS", ALL);
  assert.deepEqual(top.matched, ["pancreatic cancer", "KRAS"]);
  assert.equal(top.coverage, 1);
});

test("minimum coverage removes communities that share only one word", () => {
  const strict = rankCommunities("pancreatic cancer KRAS", ALL, { minCoverage: MATCH_MIN_COVERAGE }).map((r) => r.community.name);
  assert.deepEqual(strict, ["Pancreatic Cancer Research", "KRAS Drug Discovery"].filter((n) => strict.includes(n)));
  assert.ok(!strict.includes("Cancer Patients Network"));
  assert.ok(!strict.includes("Lung Cancer Genomics"));
  assert.ok(strict.includes("Pancreatic Cancer Research"));
});

test("a one-word query still matches on that word", () => {
  const r = rankCommunities("KRAS", ALL, { minCoverage: MATCH_MIN_COVERAGE }).map((x) => x.community.name);
  assert.deepEqual(r.sort(), ["KRAS Drug Discovery", "Pancreatic Cancer Research"]);
});

test("limit caps the list; nothing matching or nothing distinctive gives an empty list", () => {
  assert.equal(rankCommunities("cancer", ALL, { limit: 2 }).length, 2);
  assert.deepEqual(rankCommunities("quantum chromodynamics", ALL), []);
  assert.deepEqual(rankCommunities("of the", ALL), []);
  assert.deepEqual(rankCommunities("", ALL), []);
});

test("equal scores keep the input (alphabetical) order", () => {
  const a = c("Alpha KRAS", null);
  const b = c("Beta KRAS", null);
  assert.deepEqual(rankCommunities("KRAS", [a, b]).map((r) => r.community.name), ["Alpha KRAS", "Beta KRAS"]);
});

test("matchAction: Join for open, Request to join for others, sign-in when signed out, nothing once in", () => {
  assert.deepEqual(matchAction({ isOpen: true, state: "none" }), { kind: "join", label: "Join" });
  assert.deepEqual(matchAction({ isOpen: false, state: "none" }), { kind: "request", label: "Request to join" });
  assert.equal(matchAction({ isOpen: true, state: "signed_out" }).kind, "signin");
  assert.equal(matchAction({ isOpen: false, state: "signed_out" }).label, "Sign in to request");
  assert.deepEqual(matchAction({ isOpen: true, state: "active" }), { kind: "none", label: "Member" });
  assert.deepEqual(matchAction({ isOpen: false, state: "pending" }), { kind: "none", label: "Request pending" });
});

test("pickPeopleMatch: the best community the viewer is NOT in; one they are in only if nothing else matches", () => {
  const m = (id: string, state: "none" | "active" | "pending" | "signed_out") => ({ id, state });
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("kras-lab", "none"), m("other", "none")])?.id, "kras-lab");
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("pend", "pending")])?.id, "pend", "a pending request is not membership");
  assert.equal(pickPeopleMatch([m("a", "signed_out"), m("b", "signed_out")])?.id, "a");
  assert.equal(pickPeopleMatch([m("colabo", "active"), m("also", "active")])?.id, "colabo", "all member: show the best, as 'You're a member'");
  assert.equal(pickPeopleMatch([]), null, "nothing matches: the card stays hidden");
});

// The live communities' own wording (2026-11-17), with member counts.
const site = (name: string, description: string, topics: string[], member_count: number) => ({
  ...c(name, description, topics),
  member_count,
});
const NEURO = site("UAB Neuro-oncology", "The UAB Neuro-oncology group's shared space for lab expertise, techniques, and resources.", [], 1);
const FEST = site("CollaboFest 2026", "The annual cross-lab hackathon.", ["pancreatic ductal adenocarcinoma", "KRAS G12D inhibitor", "glioblastoma drug resistance", "tumor microenvironment immunotherapy"], 14);
const HEREP = site("UAB HEREP", "Junior faculty and postdoctoral fellows in population and community-engaged health research.", ["ovarian cancer SPOP proteostasis", "lung cancer survivorship telerehabilitation veterans", "community health worker dementia detection"], 4);
const AIMED = site("AI for Medicine", "A community for clinicians, researchers and engineers applying AI to diagnosis, treatment and patient care.", [], 1);
const SITE = [AIMED, FEST, HEREP, NEURO];

test("brain tumor glioblastoma research finds UAB Neuro-oncology through synonyms, with the reason", () => {
  const r = matchCommunityList("brain tumor glioblastoma research", SITE);
  const names = r.map((x) => x.community.name);
  assert.ok(names.includes("UAB Neuro-oncology"));
  assert.ok(names.includes("CollaboFest 2026"));
  const neuro = r.find((x) => x.community === NEURO)!;
  assert.deepEqual(neuro.matched, ["brain (neuro-oncology)", "tumor (oncology)", "glioblastoma (neuro-oncology)"]);
  assert.equal(matchReason(neuro.matched), "Matched on: brain (neuro-oncology), tumor (oncology), glioblastoma (neuro-oncology)");
});

test("signed out, the visibility rule still hides a 1-member community from matches", () => {
  const names = matchCommunityList("brain tumor glioblastoma research", visibleCommunities(SITE, false)).map((x) => x.community.name);
  assert.ok(!names.includes("UAB Neuro-oncology"));
  assert.ok(names.includes("CollaboFest 2026"));
});

test("the user's own word outranks a synonym", () => {
  const [top] = matchCommunityList("glioblastoma", SITE);
  assert.equal(top.community, FEST);
  assert.deepEqual(top.matched, ["glioblastoma"]);
});

test("cancer reaches a neuro-oncology community; neuro-oncology still matches exactly", () => {
  assert.ok(matchCommunityList("cancer", SITE).some((x) => x.community === NEURO));
  const [top] = matchCommunityList("neuro-oncology", SITE);
  assert.equal(top.community, NEURO);
  assert.deepEqual(top.matched, ["neuro oncology"]);
});

test("a short query matches on one specific shared word, never on a broad one alone", () => {
  // 2 words, only "dementia" (specific) shared: relaxed coverage applies.
  assert.deepEqual(matchCommunityList("dementia genetics", SITE).map((x) => x.community), [HEREP]);
  // Only the broad word "cancer" is shared with the other three: no relaxed match.
  const r = rankCommunities("pancreatic cancer KRAS", ALL, { synonyms: true });
  const kept = matchCommunityList("pancreatic cancer KRAS", ALL).map((x) => x.community.name);
  assert.ok(r.some((x) => x.community.name === "Lung Cancer Genomics"));
  assert.ok(!kept.includes("Lung Cancer Genomics"));
  assert.ok(!kept.includes("Cancer Patients Network"));
  // 4+ words keep the strict coverage.
  assert.equal(queryTokens("dementia genetics sequencing biobank").length, 4);
  assert.deepEqual(matchCommunityList("dementia genetics sequencing biobank", SITE), []);
});

test("unrelated queries match nothing; the result list is capped", () => {
  assert.deepEqual(matchCommunityList("quantum chromodynamics", SITE), []);
  assert.deepEqual(matchCommunityList("heart failure", SITE), []);
  const many = Array.from({ length: 8 }, (_, i) => c(`Glioma Group ${i}`, null));
  assert.equal(matchCommunityList("glioma", many).length, MATCH_LIMIT);
  assert.equal(matchReason([]), "");
});

test("without the synonyms option, ranking is unchanged", () => {
  assert.deepEqual(rankCommunities("brain tumor", [NEURO]), []);
});

test("every synonym target is a word some live community uses", () => {
  const live = [
    "neuro oncology", "glioblastoma", "oncology", "tumor", "cancer", "pancreatic", "dementia",
    "smoking", "immunotherapy", "drug discovery",
  ];
  for (const targets of Object.values(TOPIC_SYNONYMS))
    for (const t of targets) assert.ok(live.includes((t.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(" ")), t);
});
