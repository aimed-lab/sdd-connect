import { NextResponse } from "next/server";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";

// Proxy for the backend's trial landscape (#82). POST { query, status_filter?,
// trial_location? } -> the grouped landscape JSON. Inputs are bounded here as
// well as in the backend. Never 500s the page: on failure it returns an empty
// landscape with error: true.

const MAX_QUERY = 200;

export async function POST(req: Request) {
  let query = "";
  let statusFilter: string[] | undefined;
  let location: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.query === "string") query = body.query.trim().slice(0, MAX_QUERY);
    if (body && Array.isArray(body.status_filter)) {
      const cleaned = body.status_filter
        .filter((s: unknown): s is string => typeof s === "string" && /^[A-Za-z_]{2,40}$/.test(s.trim()))
        .slice(0, 10);
      if (cleaned.length > 0) statusFilter = cleaned;
    }
    if (body && typeof body.trial_location === "string" && body.trial_location.trim() !== "") {
      location = body.trial_location.trim().slice(0, 100);
    }
  } catch {
    // malformed body -> empty query
  }

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
