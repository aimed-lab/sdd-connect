// lib/server/explore/trialLandscape.ts — the pure rules behind the trial
// competitive-landscape view (#82): the coverage line and the CSV of what is
// shown. No runtime imports, so `npm test` covers it and client components may
// import it.

import type { TrialLandscape } from "@/types/explore";

/** "Showing 45 of 224 registry trials", or without the total when the
 *  registry did not return one. */
export function coverageLine(data: Pick<TrialLandscape, "shown" | "total">): string {
  const noun = (n: number) => (n === 1 ? "registry trial" : "registry trials");
  if (typeof data.total === "number" && data.total >= data.shown) {
    return `Showing ${data.shown} of ${data.total.toLocaleString("en-US")} ${noun(data.total)}`;
  }
  return `Showing ${data.shown} ${noun(data.shown)}`;
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const LANDSCAPE_CSV_HEADER = ["Asset", "Phase", "Sponsor", "NCT ID", "Status", "Start", "Title", "URL"];

/** One line per (asset, phase, sponsor, trial) in the order shown. */
export function landscapeCsv(data: Pick<TrialLandscape, "groups">): string {
  const lines = [LANDSCAPE_CSV_HEADER.map(csvCell).join(",")];
  for (const g of data.groups) {
    for (const r of g.rows) {
      for (const t of r.trials) {
        lines.push(
          [g.asset, r.phase, r.sponsor, t.nct_id, t.status ?? "", t.start_date ?? "", t.title, t.url]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }
  return lines.join("\r\n") + "\r\n";
}

/** A file name like "trial-landscape-kras-g12c.csv". */
export function landscapeCsvName(query: string): string {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `trial-landscape${slug ? `-${slug}` : ""}.csv`;
}
