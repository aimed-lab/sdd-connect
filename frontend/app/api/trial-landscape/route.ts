import { NextResponse } from "next/server";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { clientIp, createRateLimiter } from "@/lib/server/rateLimit";
import {
  LANDSCAPE_BODY_MAX_CHARS,
  LANDSCAPE_MAX_PER_WINDOW,
  SEARCH_WINDOW_MS,
  gateLandscapeRequest,
} from "@/lib/server/searchRequest";

// Proxy for the backend's trial landscape (#82). POST { query, status_filter?,
// trial_location? } -> the grouped landscape JSON. Same limits pattern as
// /api/explore: too many requests from one IP get a 429 with Retry-After, and
// out-of-bounds input a 400, both with a `message`. Otherwise it never 500s the
// page: on failure it returns an empty landscape with error: true.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, LANDSCAPE_MAX_PER_WINDOW);

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > LANDSCAPE_BODY_MAX_CHARS) {
    return NextResponse.json({ groups: [], error: true, message: "Request is too large." }, { status: 400 });
  }
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    // unreadable body -> empty query
  }
  const gate = gateLandscapeRequest(limiter, clientIp(req), raw);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status, headers: gate.headers });
  const { query, statusFilter, location } = gate.request;

  const empty = { query, total: null, fetched: 0, shown: 0, without_asset: 0, partial: false, exhaustive: false, groups: [] };
  if (!query) return NextResponse.json(empty);

  try {
    const payload: Record<string, unknown> = { query };
    if (statusFilter) payload.status_filter = statusFilter;
    if (location) payload.trial_location = location;
    const res = await fetch(`${EXPLORE_API_URL}/api/trial-landscape`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`trial landscape backend responded ${res.status}`);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ ...empty, error: true }, { status: 200 });
  }
}
