// lib/server/explore/trialGlossary.ts — plain-language labels for the
// ClinicalTrials.gov terms on Explore's trial results (phase, status,
// intervention type), and the rows of the "compare up to 3 trials" table.
// Everything here is a fixed glossary or a field already in the trial's `raw`;
// nothing is generated, so a label can never misstate a trial. Pure, so
// `npm test` covers it.

import type { ExploreItem, TrialRaw } from "@/types/explore";

export type Gloss = { label: string; plain: string };

const PHASES: Record<string, Gloss> = {
  EARLY_PHASE1: { label: "Early phase 1", plain: "A very small first study in people, before phase 1." },
  PHASE1: { label: "Phase 1", plain: "First tests in people, mainly to check safety and dose." },
  PHASE2: { label: "Phase 2", plain: "Checks whether it works and keeps watching safety, in more people." },
  PHASE3: { label: "Phase 3", plain: "Compares it with the usual treatment in many people; often the last step before approval." },
  PHASE4: { label: "Phase 4", plain: "Follows a treatment that is already approved, in everyday use." },
  NA: { label: "No phase", plain: "Phases apply to drug trials; this study (for example a device or behaviour study) has none." },
};

const STATUSES: Record<string, Gloss> = {
  RECRUITING: { label: "Recruiting", plain: "Looking for participants now." },
  NOT_YET_RECRUITING: { label: "Not yet recruiting", plain: "Will look for participants soon." },
  ENROLLING_BY_INVITATION: { label: "Enrolling by invitation", plain: "Only people who are invited can join." },
  ACTIVE_NOT_RECRUITING: { label: "Active, not recruiting", plain: "Under way, but not taking new participants." },
  COMPLETED: { label: "Completed", plain: "Finished as planned." },
  SUSPENDED: { label: "Suspended", plain: "Paused for now; it may restart." },
  TERMINATED: { label: "Terminated", plain: "Stopped early, before it was finished." },
  WITHDRAWN: { label: "Withdrawn", plain: "Stopped before anyone took part." },
  UNKNOWN: { label: "Status unknown", plain: "Not updated recently, so its status is unclear." },
};

const INTERVENTION_TYPES: Record<string, string> = {
  DRUG: "Drug",
  BIOLOGICAL: "Biologic (made from living cells)",
  GENETIC: "Gene therapy",
  DEVICE: "Medical device",
  PROCEDURE: "Procedure or surgery",
  RADIATION: "Radiation",
  BEHAVIORAL: "Behaviour or lifestyle",
  DIETARY_SUPPLEMENT: "Dietary supplement",
  COMBINATION_PRODUCT: "Drug and device together",
  DIAGNOSTIC_TEST: "Diagnostic test",
  OTHER: "Other",
};

const key = (v: string | null | undefined) => (v ?? "").trim().toUpperCase().replace(/[\s,/-]+/g, "_");

/** "PHASE1" -> Phase 1 with its plain meaning; an unknown value keeps its own
 *  text (tidied) with no explanation; nothing -> null. */
export function phaseGloss(phase: string | null | undefined): Gloss | null {
  const k = key(phase);
  if (!k) return null;
  return PHASES[k] ?? { label: tidy(phase!), plain: "" };
}

export function statusGloss(status: string | null | undefined): Gloss | null {
  const k = key(status);
  if (!k) return null;
  return STATUSES[k] ?? { label: tidy(status!), plain: "" };
}

export function interventionTypeLabel(type: string | null | undefined): string | null {
  const k = key(type);
  if (!k) return null;
  return INTERVENTION_TYPES[k] ?? tidy(type!);
}

/** "ACTIVE_NOT_RECRUITING" -> "Active not recruiting". */
function tidy(v: string): string {
  const s = v.trim().replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "Pembrolizumab (Drug)" for each intervention with a name. */
export function interventionList(raw: TrialRaw): string[] {
  if (!Array.isArray(raw.interventions)) return [];
  const out: string[] = [];
  for (const iv of raw.interventions) {
    const name = str(iv?.name);
    if (!name) continue;
    const type = interventionTypeLabel(str(iv?.type));
    out.push(type ? `${name} (${type})` : name);
  }
  return out;
}

export function conditionList(raw: TrialRaw): string[] {
  return Array.isArray(raw.conditions) ? raw.conditions.map(str).filter((c): c is string => !!c) : [];
}

/** Where the trial runs, when the response carries locations: strings, or
 *  {facility, city, state, country} objects shown as "City, Country". */
export function locationList(raw: TrialRaw): string[] {
  if (!Array.isArray(raw.locations)) return [];
  const out: string[] = [];
  for (const loc of raw.locations) {
    const text =
      str(loc) ??
      (loc && typeof loc === "object"
        ? [str((loc as Record<string, unknown>).city), str((loc as Record<string, unknown>).country)].filter(Boolean).join(", ") ||
          str((loc as Record<string, unknown>).facility)
        : null);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** "a, b, c" then "and N more" past `max`. */
export function shortList(xs: string[], max = 3): string {
  if (xs.length <= max) return xs.join(", ");
  return `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;
}

export const MAX_COMPARE = 3;

/** Adds or removes `id`; adding past MAX_COMPARE leaves the list as it is. */
export function toggleCompare(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return selected.length >= MAX_COMPARE ? selected : [...selected, id];
}

export type CompareRow = { label: string; cells: string[] };

/** The comparison table: one column per trial, one row per field. A row that
 *  is empty for every trial is left out (e.g. Locations, until the response
 *  carries them); an empty cell reads "Not listed". */
export function compareRows(items: ExploreItem[]): CompareRow[] {
  const raws = items.map((i) => (i.raw ?? {}) as TrialRaw);
  const glossed = (g: Gloss | null) => (g ? (g.plain ? `${g.label}: ${g.plain}` : g.label) : "");
  const rows: CompareRow[] = [
    { label: "Status", cells: raws.map((r) => glossed(statusGloss(r.overall_status))) },
    { label: "Phase", cells: raws.map((r) => glossed(phaseGloss(r.phase))) },
    { label: "Sponsor", cells: raws.map((r) => str(r.lead_sponsor) ?? "") },
    { label: "Treatments tested", cells: raws.map((r) => interventionList(r).join("; ")) },
    { label: "Conditions", cells: raws.map((r) => conditionList(r).join("; ")) },
    { label: "Locations", cells: raws.map((r) => shortList(locationList(r), 5)) },
  ];
  return rows
    .filter((row) => row.cells.some(Boolean))
    .map((row) => ({ ...row, cells: row.cells.map((c) => c || "Not listed") }));
}

/** A search note the response may carry (how the query was read), as text:
 *  a string as is, an object as "key: value" pairs. Anything else -> null. */
export function noteText(v: unknown): string | null {
  const s = str(v);
  if (s) return s;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const text = str(val) ?? (Array.isArray(val) ? val.map(str).filter(Boolean).join(", ") : null);
    if (text) parts.push(`${k.replace(/_/g, " ")}: ${text}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
