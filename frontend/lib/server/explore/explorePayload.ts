import { getCurrentUserInterests } from "@/lib/server/interests";
import { getProject } from "@/lib/server/projects";
import { buildProjectExploreQuery } from "@/lib/projectTypes";
import { clientIp, type RateLimiter } from "@/lib/server/rateLimit";
import {
  EXPLORE_BODY_MAX_CHARS,
  RATE_LIMITED_MESSAGE,
  parseExploreBody,
} from "@/lib/server/searchRequest";
import { EXPLORE_EMAIL_MESSAGE, exploreTextHasEmail } from "@/lib/server/explore/emailGuard";

// The request side of /api/explore and /api/explore/stream: request limits,
// body parsing, the project-derived input and the personalized landing-feed
// scope. See app/api/explore/route.ts for why each step is done here. A
// rejection is returned as its status and message; the routes build the 400 /
// 429 bodies themselves (lib/server/openapi.test.ts reads them there).

export type ExplorePayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: 400 | 429; message: string };

export async function buildExplorePayload(req: Request, limiter: RateLimiter): Promise<ExplorePayloadResult> {
  if (limiter.limited(clientIp(req))) {
    return { ok: false, status: 429, message: RATE_LIMITED_MESSAGE };
  }

  if (Number(req.headers.get("content-length") ?? 0) > EXPLORE_BODY_MAX_CHARS) {
    return { ok: false, status: 400, message: "Request is too large." };
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
    return { ok: false, status: 400, message: parsed.message };
  }
  // Never search an email address (the search boxes hand such text to the assistant;
  // this is the backstop for anything else). Refused before any backend call.
  if (exploreTextHasEmail(parsed.input)) {
    return { ok: false, status: 400, message: EXPLORE_EMAIL_MESSAGE };
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

  const payload: Record<string, unknown> = scope.length > 0 ? { input, scope } : { input };
  if (sinceYear !== undefined) payload.since_year = sinceYear;
  if (statusFilter !== undefined) payload.status_filter = statusFilter;
  if (onlyKinds !== undefined && input.trim()) payload.only_kinds = onlyKinds;
  if (input.trim()) Object.assign(payload, sourceFilters);
  return { ok: true, payload };
}
