// Run with `npm test`. The trial landscape view's coverage line and CSV export.

import test from "node:test";
import assert from "node:assert/strict";
import { coverageLine, landscapeCsv, landscapeCsvName } from "./trialLandscape.ts";

const data = {
  groups: [
    {
      asset: "Divarasib",
      key: "divarasib",
      aliases: ["GDC-6036"],
      trial_count: 2,
      rows: [
        {
          phase: "Phase 3",
          sponsor: "Hoffmann-La Roche",
          trials: [
            { nct_id: "NCT07541170", url: "https://clinicaltrials.gov/study/NCT07541170", title: "Divarasib vs, \"standard\" care", status: "RECRUITING", start_date: "2025-06" },
          ],
        },
        {
          phase: "Phase 1/2",
          sponsor: "=HYPERLINK(\"x\")",
          trials: [
            { nct_id: "NCT05789082", url: "https://clinicaltrials.gov/study/NCT05789082", title: "Combo", status: null, start_date: null },
          ],
        },
      ],
    },
  ],
};

test("coverage line uses the registry's total", () => {
  assert.equal(coverageLine({ shown: 45, total: 224 }), "Showing 45 of 224 registry trials");
  assert.equal(coverageLine({ shown: 45, total: 12345 }), "Showing 45 of 12,345 registry trials");
  assert.equal(coverageLine({ shown: 1, total: 1 }), "Showing 1 of 1 registry trial");
});

test("coverage line without a total says only what is shown", () => {
  assert.equal(coverageLine({ shown: 3, total: null }), "Showing 3 registry trials");
});

test("CSV has one line per shown trial, in order, quoted and formula-safe", () => {
  const lines = landscapeCsv(data).trimEnd().split("\r\n");
  assert.equal(lines[0], "Asset,Phase,Sponsor,NCT ID,Status,Start,Title,URL");
  assert.equal(
    lines[1],
    'Divarasib,Phase 3,Hoffmann-La Roche,NCT07541170,RECRUITING,2025-06,"Divarasib vs, ""standard"" care",https://clinicaltrials.gov/study/NCT07541170',
  );
  assert.equal(
    lines[2],
    `Divarasib,Phase 1/2,"'=HYPERLINK(""x"")",NCT05789082,,,Combo,https://clinicaltrials.gov/study/NCT05789082`,
  );
  assert.equal(lines.length, 3);
});

test("CSV file name is a slug of the query", () => {
  assert.equal(landscapeCsvName("KRAS G12C"), "trial-landscape-kras-g12c.csv");
  assert.equal(landscapeCsvName("  "), "trial-landscape.csv");
});
