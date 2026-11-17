// Shapes returned by the Python explore backend (via /api/explore).

export type Signal = {
  metric: string; // "citations" | "stars" | "recency"
  value: number;
  as_of: string;
};

export type ExploreItem = {
  id: string;
  kind: string; // paper | preprint | news | trial | approval | grant | tool | dataset | geneset | compound | target | resource | person | episode
  title: string;
  summary: string | null;
  url: string | null;
  doi?: string | null;
  source: string;
  date_iso: string | null;
  signal: Signal | null;
  dedupe_key?: string;
  raw?: Record<string, unknown>;
  /** Papers only: a verbatim excerpt of the abstract (PubMed efetch or
   *  OpenAlex). Absent when no abstract was found; the card then shows no
   *  snippet. */
  abstract?: string | null;
};

/** Why a section has no items (backend/explore-mcp/tools/explore.py). Only
 *  "timed_out" is rendered specially today: the source didn't answer in time,
 *  which is not the same as finding nothing. */
export type EmptyReason =
  | "no_results"
  | "off_topic_filtered"
  | "no_query"
  | "source_error"
  | "timed_out"
  | "tool_query";

export type ExploreSection = {
  tool: string;
  kind: string;
  query?: string;
  items: ExploreItem[];
  /** Papers section ONLY (kind === "paper"): the SAME already-fetched/ranked
   *  pool as `items`, but ordered by WINNER's own re-rank instead of date
   *  desc — rendered as a second "Key Papers" subsection under the same
   *  Papers tab (see backend/explore-mcp/tools/explore.py's search_papers
   *  handling, and CategoryStrip — there is no separate "key papers" kind
   *  or tab). Absent for every other section kind. */
  items_key?: ExploreItem[];
  /** Papers section, typed searches only: the same papers ordered by how many
   *  of the searched words their title and abstract contain ("Most relevant").
   *  Newest first (`items`) stays the default. */
  items_relevant?: ExploreItem[];
  error?: string;
  /** The source didn't respond before its time limit; retrying usually works
   *  (its fetch keeps running and fills the backend cache). */
  timed_out?: boolean;
  empty_reason?: EmptyReason;
  /** A short source caveat with a link, e.g. the FDA data-lag note on the
   *  approvals section. */
  note?: { text: string; url?: string };
  /** How the query was read for this source, when the backend sends it. */
  interpreted?: unknown;
};

/** The structured scope the backend either extracted from a search or used for
 *  the landing feed. `is_personalized` marks the one case the UI acts on: a
 *  blank-input feed scoped to the signed-in user's saved interests, which sit in
 *  `topics` (see backend/explore-mcp/tools/explore.py). */
export type ExploreScope = Record<string, unknown> & {
  topics?: string[];
  is_default?: boolean;
  is_personalized?: boolean;
};

/** backend/explore-mcp/sources/clinical_trials.py's `raw` shape — a handful
 *  of first-party fields, no top-level Item field for any of them. `why_stopped`
 *  MUST be rendered verbatim wherever it's shown, never through any LLM/
 *  summarization step — see components/ItemCard.tsx. */
export type TrialRaw = {
  nct_id?: string;
  overall_status?: string | null;
  why_stopped?: string | null;
  phase?: string | null;
  interventions?: { type?: string | null; name?: string | null }[] | null;
  lead_sponsor?: string | null;
  conditions?: string[] | null;
  /** Up to 5 sites (backend `_locations`); `site_count` is the full number. */
  sites?: { facility?: string; city?: string; state?: string; country?: string; status?: string }[] | null;
  site_count?: number | null;
  location_states?: string[] | null;
  /** Shown when present: strings or {facility, city, state, country}. */
  locations?: unknown[] | null;
  eligibility?: {
    min_age?: string;
    max_age?: string;
    sex?: string;
    healthy_volunteers?: boolean;
    criteria_excerpt?: string;
  } | null;
};

/** backend/explore-mcp/sources/openfda.py's `raw` shape (kind "approval").
 *  approval_date is YYYYMMDD. */
export type ApprovalRaw = {
  brand?: string | null;
  generic?: string | null;
  sponsor?: string | null;
  application_number?: string | null;
  approval_date?: string | null;
  review_priority?: string | null;
  /** The label's "indications and usage" text (cut at 300 chars). */
  indication?: string | null;
  /** The first sentence of that text, verbatim. */
  indication_first_sentence?: string | null;
};

/** kind "tool" (backend/explore-mcp/sources/github.py, GitHub repository
 *  search): the only `raw` fields that pass the egress allow-list. pushed_at is
 *  the last push to the repo ("last code update"), not a release date. */
export type ToolRaw = {
  license_spdx?: string | null;
  language?: string | null;
  topics?: string[];
  pushed_at?: string | null;
};

/** backend/explore-mcp/sources/europepmc.py's `raw` shape (kind "preprint"). */
export type PreprintRaw = {
  server?: string | null;
  authors?: string | null;
  doi?: string | null;
};

/** backend/explore-mcp/sources/grants_gov.py's `raw` shape. Dates are the
 *  strings Grants.gov sends (MMDDYYYY), not ISO. */
export type GrantRaw = {
  number?: string | null;
  agency?: string | null;
  agency_code?: string | null;
  status?: string | null;
  open_date?: string | null;
  close_date?: string | null;
};

/** backend/explore-mcp/sources/chembl.py's `raw` shape — a handful of
 *  first-party fields, no top-level Item field for any of them. Two record
 *  kinds share this shape: a mechanism-of-action record (mechanism_of_action/
 *  max_phase/action_type/mutation/pubmed_ids populated, bioactivity fields
 *  absent) and a bioactivity record (pchembl_value/standard_type/
 *  standard_value/standard_units/assay_description populated, mechanism
 *  fields absent). */
export type ChemblRaw = {
  molecule_chembl_id?: string;
  pref_name?: string | null;
  mechanism_of_action?: string | null;
  max_phase?: number | null;
  action_type?: string | null;
  mutation?: string | null;
  pubmed_ids?: string[];
  pchembl_value?: number | string | null;
  standard_type?: string | null;
  standard_value?: number | string | null;
  standard_units?: string | null;
  assay_description?: string | null;
};

/** backend/explore-mcp/sources/opentargets.py's `raw` shape — a handful of
 *  first-party, curated fields, no top-level Item field for any of them. ONE
 *  target-disease association per item (not a nested list of several). */
export type OpenTargetsEvidence = {
  type?: string; // e.g. "genetic_association" | "literature" | "animal_model" | "known_drug"
  score?: number;
};

export type OpenTargetsTractability = {
  label?: string;
  modality?: string;
  value?: boolean;
};

export type OpenTargetsRaw = {
  target_ensembl_id?: string;
  target_symbol?: string;
  target_name?: string | null;
  disease_id?: string;
  disease_name?: string;
  score?: number | null;
  evidence?: OpenTargetsEvidence[];
  tractability?: OpenTargetsTractability[];
  /** Only present when scope had BOTH a gene and a disease (see
   *  sources/opentargets.py's fetch_opentargets/_fetch_by_gene). true = this
   *  IS the specific target-disease pair the query asked about (shown as the
   *  primary/unlabeled result); false = broader top-scoring context, not an
   *  answer to the query's disease, and must be visibly labeled as such
   *  (see ItemCard.tsx). Absent for a gene-only query — nothing to
   *  distinguish there, current top-by-score behavior stands unlabeled. */
  matched_query_disease?: boolean;
};

export type ExploreResponse = {
  input?: string;
  scope?: ExploreScope;
  tools_called?: string[];
  reasoning?: string | null;
  sections: ExploreSection[];
  error?: boolean;
  /** What the search was read as (backend `_interpreted`: entities,
   *  filters, not_applied, label); shown when present. */
  interpreted?: unknown;
  /** Set with a 429: the caller sent too many searches in a short time. */
  rate_limited?: boolean;
  /** A reason to show instead of the generic error copy (400 / 429). */
  message?: string;
};

/** POST /api/trial-landscape (#82): one bounded ClinicalTrials.gov search,
 *  grouped by normalised intervention, then phase and lead sponsor. */
export type TrialLandscapeTrial = {
  nct_id: string;
  url: string;
  title: string;
  status: string | null;
  start_date: string | null;
};

export type TrialLandscapeRow = {
  phase: string;
  sponsor: string;
  trials: TrialLandscapeTrial[];
};

export type TrialLandscapeGroup = {
  asset: string;
  key: string;
  aliases: string[];
  trial_count: number;
  rows: TrialLandscapeRow[];
};

export type TrialLandscape = {
  query: string;
  /** ClinicalTrials.gov's own count for the search; null when it was not returned. */
  total: number | null;
  fetched: number;
  shown: number;
  without_asset: number;
  partial: boolean;
  exhaustive: false;
  groups: TrialLandscapeGroup[];
  error?: string | boolean;
  /** Set on a 400 / 429 from the route: shown instead of the generic error. */
  message?: string;
};
