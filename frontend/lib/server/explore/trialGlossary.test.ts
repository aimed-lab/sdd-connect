// Run with `npm test`. Plain-language trial labels and the compare table.

import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRows,
  conditionList,
  eligibilityText,
  emptyReasonText,
  interventionList,
  locationList,
  MAX_COMPARE,
  noteText,
  phaseGloss,
  shortList,
  siteTotal,
  statusGloss,
  toggleCompare,
} from "./trialGlossary.ts";

const trial = (id: string, raw: Record<string, unknown>) =>
  ({ id, kind: "trial", title: id, summary: null, url: null, source: "clinicaltrials", date_iso: null, signal: null, raw }) as never;

test("phaseGloss: ClinicalTrials.gov phases in plain words", () => {
  assert.deepEqual(phaseGloss("PHASE1"), { label: "Phase 1", plain: "First tests in people, mainly to check safety and dose." });
  assert.equal(phaseGloss("EARLY_PHASE1")!.label, "Early phase 1");
  assert.equal(phaseGloss("phase3")!.label, "Phase 3");
  assert.equal(phaseGloss("NA")!.label, "No phase");
  assert.deepEqual(phaseGloss("PHASE9"), { label: "Phase9", plain: "" });
  assert.equal(phaseGloss(null), null);
  assert.equal(phaseGloss(""), null);
});

test("statusGloss: every status a trial can have reads as words", () => {
  assert.deepEqual(statusGloss("RECRUITING"), { label: "Recruiting", plain: "Looking for participants now." });
  assert.equal(statusGloss("ACTIVE_NOT_RECRUITING")!.label, "Active, not recruiting");
  assert.equal(statusGloss("Terminated")!.plain, "Stopped early, before it was finished.");
  assert.deepEqual(statusGloss("AVAILABLE_FOR_EXPANDED_ACCESS"), { label: "Available for expanded access", plain: "" });
  assert.equal(statusGloss(undefined), null);
});

test("interventionList names each treatment with its type in plain words", () => {
  assert.deepEqual(
    interventionList({ interventions: [{ type: "GENETIC", name: "AAV9-SOD1" }, { type: "DRUG", name: "Placebo" }, { type: "DRUG", name: "" }, { name: "Diet" }] }),
    ["AAV9-SOD1 (Gene therapy)", "Placebo (Drug)", "Diet"]
  );
  assert.deepEqual(interventionList({}), []);
});

test("conditionList and locationList keep only real text", () => {
  assert.deepEqual(conditionList({ conditions: ["ALS", " ", "Motor neuron disease"] }), ["ALS", "Motor neuron disease"]);
  assert.deepEqual(conditionList({ conditions: null }), []);
  assert.deepEqual(
    locationList({ locations: ["Boston, United States", { city: "Paris", country: "France" }, { facility: "Site 12" }, { city: "Paris", country: "France" }, 7] }),
    ["Boston, United States", "Paris, France", "Site 12"]
  );
  assert.deepEqual(locationList({}), []);
});

test("shortList says how many more there are", () => {
  assert.equal(shortList(["a", "b"]), "a, b");
  assert.equal(shortList(["a", "b", "c", "d", "e"]), "a, b, c and 2 more");
});

test("toggleCompare adds up to three trials and removes on a second click", () => {
  assert.equal(MAX_COMPARE, 3);
  let s: string[] = [];
  for (const id of ["a", "b", "c", "d"]) s = toggleCompare(s, id);
  assert.deepEqual(s, ["a", "b", "c"]);
  assert.deepEqual(toggleCompare(s, "b"), ["a", "c"]);
});

test("compareRows: one cell per trial, from the trial's own fields only", () => {
  const rows = compareRows([
    trial("t1", {
      overall_status: "RECRUITING",
      phase: "PHASE1",
      lead_sponsor: "Biogen",
      interventions: [{ type: "GENETIC", name: "Tofersen" }],
      conditions: ["ALS"],
    }),
    trial("t2", { overall_status: "COMPLETED", phase: "NA", conditions: ["ALS", "FTD"] }),
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["Status", "Phase", "Sponsor", "Treatments tested", "Conditions"], "no Locations row when no trial has any");
  const cell = (label: string) => rows.find((r) => r.label === label)!.cells;
  assert.deepEqual(cell("Status"), ["Recruiting: Looking for participants now.", "Completed: Finished as planned."]);
  assert.equal(cell("Phase")[0], "Phase 1: First tests in people, mainly to check safety and dose.");
  assert.deepEqual(cell("Sponsor"), ["Biogen", "Not listed"]);
  assert.deepEqual(cell("Treatments tested"), ["Tofersen (Gene therapy)", "Not listed"]);
  assert.deepEqual(cell("Conditions"), ["ALS", "ALS; FTD"]);
});

test("compareRows shows locations when the response carries them", () => {
  const rows = compareRows([trial("t1", { locations: [{ city: "Boston", country: "United States" }] }), trial("t2", {})]);
  assert.deepEqual(rows, [{ label: "Locations", cells: ["Boston, United States", "Not listed"] }]);
});

test("noteText reads a string or an object of strings, and nothing else", () => {
  assert.equal(noteText("  condition: ALS "), "condition: ALS");
  assert.equal(noteText({ condition: "ALS", genes: ["SOD1", "C9orf72"], n: 3 }), "condition: ALS · genes: SOD1, C9orf72");
  assert.equal(noteText(null), null);
  assert.equal(noteText(["ALS"]), null);
  assert.equal(noteText({}), null);
});

test("the backend's sites come before locations, with the full site count", () => {
  const raw = {
    sites: [{ facility: "UAB", city: "Birmingham", state: "Alabama", country: "United States" }, { city: "Lyon", country: "France" }],
    site_count: 14,
    locations: ["ignored"],
  };
  assert.deepEqual(locationList(raw), ["Birmingham, Alabama", "Lyon, France"]);
  assert.equal(siteTotal(raw), 14);
  assert.equal(shortList(locationList(raw), 3, siteTotal(raw)), "Birmingham, Alabama, Lyon, France and 12 more");
  assert.equal(siteTotal({}), 0);
});

test("eligibilityText reads ages, sex and healthy volunteers", () => {
  assert.equal(
    eligibilityText({ eligibility: { min_age: "18 Years", max_age: "75 Years", sex: "ALL", healthy_volunteers: false } }),
    "Ages 18 Years to 75 Years · Any sex · No healthy volunteers"
  );
  assert.equal(eligibilityText({ eligibility: { min_age: "12 Years", sex: "FEMALE" } }), "Ages 12 Years and over · Women only");
  assert.equal(eligibilityText({}), "");
});

test("compareRows adds who can join and sites from the new trial fields", () => {
  const rows = compareRows([
    trial("t1", { eligibility: { min_age: "18 Years" }, sites: [{ city: "Boston", state: "Massachusetts" }], site_count: 3 }),
    trial("t2", {}),
  ]);
  assert.deepEqual(rows, [
    { label: "Who can join", cells: ["Ages 18 Years and over", "Not listed"] },
    { label: "Locations", cells: ["Boston, Massachusetts and 2 more", "Not listed"] },
  ]);
});

test("emptyReasonText explains the codes that need words, and only those", () => {
  assert.match(emptyReasonText("no_results")!, /no trials/);
  assert.match(emptyReasonText("off_topic_filtered")!, /left out/);
  for (const code of ["timed_out", "source_error", "tool_query", "no_query", null, 3]) assert.equal(emptyReasonText(code), null);
});

test("noteText reads the backend's interpreted object by its label", () => {
  assert.equal(noteText({ entities: ["KRAS G12C"], filters: [{ key: "status" }], not_applied: [], label: "KRAS G12C · Recruiting" }), "KRAS G12C · Recruiting");
  assert.equal(noteText({ label: "ALS", not_applied: ["location: Alabama"] }), "ALS (not applied: location: Alabama)");
  assert.equal(noteText({ entities: [], filters: [], label: "" }), null);
});
