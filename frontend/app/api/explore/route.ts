import { NextResponse } from "next/server";
import { getCurrentUserInterests } from "@/lib/server/interests";
import { getProject } from "@/lib/server/projects";
import { buildProjectExploreQuery } from "@/lib/projectTypes";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { cleanSectionTitles } from "@/lib/server/explore/exploreLayout";
import { clientIp, createRateLimiter } from "@/lib/server/rateLimit";
import {
  EXPLORE_BODY_MAX_CHARS,
  EXPLORE_MAX_PER_WINDOW,
  RATE_LIMITED_MESSAGE,
  SEARCH_WINDOW_MS,
  parseExploreBody,
  retryAfterHeaders,
} from "@/lib/server/searchRequest";

// Proxy for the Python explore backend. POST { input } -> the backend's
// { input, scope, tools_called, reasoning, sections } JSON. The backend exposes
// a plain-HTTP bridge at POST /api/explore (added alongside its MCP interface).
//
// PERSONALIZATION. A blank `input` asks for the landing feed. Before forwarding
// it, this route reads the SIGNED-IN user's saved interests and sends them on as
// the feed's scope, so a logged-in scientist's front page is about their own
// work instead of the field at large. Signed out, or with no interests saved,
// nothing is sent and the backend serves the generic field-wide default.
//
// The interests are read HERE, from the session cookie, and are never accepted
// from the request body: a caller cannot ask for someone else's feed, and the
// browser never has to be trusted with (or told) what the scope should be. The
// backend caches the result under the terms' own normalized key, so one user's
// feed can neither be served from nor overwrite the shared default entry.
//
// `personalize: false` opts a request out — the feed sends it when the user has
// cleared the scope chips, which means "show me the generic feed, not mine".
//
// PROJECT-DERIVED SEARCH. `project_id` (from "Explore for this project" —
// see app/explore/[topic]/page.tsx and lib/projectTypes.ts:
// buildProjectExploreHref) asks this route to derive the FULL rich search
// input SERVER-SIDE from that project, instead of searching whatever short
// text the client sent. Same pattern as app/api/project-agent/start/
// route.ts: the client supplies only an id, membership is checked via
// getProject()'s own RLS-backed gate, and the actual free-text query
// (name + description + target/indication/modality —
// buildProjectExploreQuery, the same builder the OLD client-side version
// used) is built here from data the caller is verified to belong to. This
// is what lets the visible URL/search-box stay a short, readable string
// (see buildProjectExploreTopic) while search QUALITY stays exactly what
// it was — the backend still gets the rich input that beats a bare
// keyword string. On any lookup failure (not found / not a member / db
// error) this falls back to searching the client-sent `input` as-is —
// degrade, don't block, same resilience stance as everything else here.
//
// Resilience contract: this route NEVER 500s the page. On any failure it returns
// { sections: [], scope: {}, error: true } with HTTP 200 so the UI can render a
// clean empty state instead of crashing. Out-of-bounds input gets a 400 and too
// many requests from one IP a 429 (with Retry-After); both carry a `message`
// the UI shows instead of an empty state.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, EXPLORE_MAX_PER_WINDOW);

// TIME BUDGET. The backend stops waiting for slow sources at its own deadline
// (EXPLORE_DEADLINE_SEC, 25 s by default — see backend/explore-mcp/tools/
// explore.py) and marks them `timed_out`, so the page gets the other results
// plus a "didn't respond in time — retry" state. This route allows 60 s and
// gives up on the backend after 55 s, so even a stalled backend ends in the
// error shape below rather than a platform timeout.
export const maxDuration = 60;
const BACKEND_TIMEOUT_MS = 55_000;

export async function POST(req: Request) {
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json(
      { sections: [], scope: {}, error: true, rate_limited: true, message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: retryAfterHeaders() }
    );
  }

  if (Number(req.headers.get("content-length") ?? 0) > EXPLORE_BODY_MAX_CHARS) {
    return NextResponse.json({ sections: [], scope: {}, error: true, message: "Request is too large." }, { status: 400 });
  }
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    // unreadable body -> treat as empty input (backend serves the default feed)
  }
  // A chosen scope (only_kinds, e.g. "Grants"): the backend queries just these
  // sources with the typed text instead of letting its router decide.
  const parsed = parseExploreBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ sections: [], scope: {}, error: true, message: parsed.message }, { status: 400 });
  }
  let input = parsed.input;
  const { personalize, projectId, sinceYear, statusFilter, onlyKinds } = parsed;
  // Optional per-source filters; the backend validates them too.
  const sourceFilters = parsed.sourceFilters ?? {};

  if (projectId) {
    const result = await getProject(projectId);
    if (result.status === "ok") {
      input = buildProjectExploreQuery(result.project);
    }
    // not_found / error -> input stays whatever the client sent (the short
    // displayed topic) rather than failing the search outright.
  }

  // Only the blank landing feed is personalized. A real search is the user's
  // explicit scope and must not be widened by their profile.
  let scope: string[] = [];
  if (personalize && !input.trim()) {
    try {
      scope = await getCurrentUserInterests();
    } catch (e) {
      // A profile read failing is not a reason to lose the feed — fall back to
      // the generic one rather than erroring the page.
      console.error("explore: interests lookup failed", e);
    }
  }

  try {
    const payload: Record<string, unknown> = scope.length > 0 ? { input, scope } : { input };
    if (sinceYear !== undefined) payload.since_year = sinceYear;
    if (statusFilter !== undefined) payload.status_filter = statusFilter;
    if (onlyKinds !== undefined && input.trim()) payload.only_kinds = onlyKinds;
    if (input.trim()) Object.assign(payload, sourceFilters);
    const res = await fetch(`${EXPLORE_API_URL}/api/explore`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`explore backend responded ${res.status}`);
    const data = await res.json();
    if (data && Array.isArray(data.sections)) data.sections = cleanSectionTitles(data.sections);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ sections: [], scope: {}, error: true }, { status: 200 });
  }
}
