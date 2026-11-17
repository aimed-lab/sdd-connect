// Run with `npm test`. Plain-language trial labels and the compare table.

import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRows,
  conditionList,
  interventionList,
  locationList,
  MAX_COMPARE,
  noteText,
  phaseGloss,
  shortList,
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
