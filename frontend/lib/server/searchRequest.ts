// Input bounds and request limits shared by the public search routes
// (app/api/explore and app/api/papers). No runtime imports, so it can be
// unit-tested directly.

export const SEARCH_TEXT_MAX = 300;
export const PAPERS_LIMIT_MIN = 1;
export const PAPERS_LIMIT_MAX = 25;
export const PAPERS_LIMIT_DEFAULT = 8;
export const EXPLORE_BODY_MAX_CHARS = 16 * 1024;
const PROJECT_ID_MAX = 64;
const LIST_MAX_ITEMS = 20;
const LIST_ITEM_MAX = 64;

// One Explore page view or topic search makes 1 call to /api/explore, and one
// episode page makes 1 call to /api/papers, so 60 a minute per IP leaves room
// for very fast browsing and for several people behind one shared network.
export const SEARCH_WINDOW_MS = 60 * 1000;
export const EXPLORE_MAX_PER_WINDOW = 60;
export const PAPERS_MAX_PER_WINDOW = 60;

export const RATE_LIMITED_MESSAGE =
  "Too many searches in a short time. Please wait a minute, then try again.";

export function retryAfterHeaders(): Record<string, string> {
  return { "Retry-After": String(Math.ceil(SEARCH_WINDOW_MS / 1000)), "Cache-Control": "no-store" };
}

const tooLong = (what: string) => `${what} is too long (at most ${SEARCH_TEXT_MAX} characters).`;

export type PapersQuery = { ok: true; q: string; limit: number } | { ok: false; message: string };

export function parsePapersQuery(params: URLSearchParams): PapersQuery {
  const q = params.get("q") ?? "";
  if (q.length > SEARCH_TEXT_MAX) return { ok: false, message: tooLong("Search text") };
  const rawLimit = params.get("limit");
  let limit = PAPERS_LIMIT_DEFAULT;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const n = Number(rawLimit);
    if (!Number.isFinite(n)) return { ok: false, message: "limit must be a number." };
    limit = Math.min(PAPERS_LIMIT_MAX, Math.max(PAPERS_LIMIT_MIN, Math.trunc(n)));
  }
  return { ok: true, q, limit };
}

export type ExploreRequest = {
  input: string;
  personalize: boolean;
  projectId?: string;
  sinceYear?: number;
  statusFilter?: string[];
  onlyKinds?: string[];
};

export type ParsedExploreBody = ({ ok: true } & ExploreRequest) | { ok: false; message: string };

function cleanList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((s: unknown): s is string => typeof s === "string" && s.trim() !== "" && s.length <= LIST_ITEM_MAX)
    .slice(0, LIST_MAX_ITEMS);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Parses the raw POST body. Malformed JSON still means "blank input" (the
 *  landing feed); only oversized input is rejected. */
export function parseExploreBody(raw: string): ParsedExploreBody {
  if (raw.length > EXPLORE_BODY_MAX_CHARS) return { ok: false, message: "Request is too large." };
  const out: ExploreRequest = { input: "", personalize: true };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: true, ...out };
  }
  if (!body || typeof body !== "object") return { ok: true, ...out };
  const b = body as Record<string, unknown>;
  if (typeof b.input === "string") {
    if (b.input.length > SEARCH_TEXT_MAX) return { ok: false, message: tooLong("Search text") };
    out.input = b.input;
  }
  if (b.personalize === false) out.personalize = false;
  if (typeof b.project_id === "string") {
    if (b.project_id.length > PROJECT_ID_MAX) return { ok: false, message: "project_id is not valid." };
    out.projectId = b.project_id;
  }
  if (typeof b.since_year === "number" && Number.isFinite(b.since_year)) out.sinceYear = b.since_year;
  out.statusFilter = cleanList(b.status_filter);
  out.onlyKinds = cleanList(b.only_kinds);
  return { ok: true, ...out };
}
