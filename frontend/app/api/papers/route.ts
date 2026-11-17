import { NextResponse } from "next/server";
import type { ExploreItem } from "@/types/explore";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { clientIp, createRateLimiter } from "@/lib/server/rateLimit";
import {
  PAPERS_MAX_PER_WINDOW,
  RATE_LIMITED_MESSAGE,
  SEARCH_WINDOW_MS,
  parsePapersQuery,
  retryAfterHeaders,
} from "@/lib/server/searchRequest";

// Proxy for the backend's live literature search (PubMed/OpenAlex/Crossref
// fan-out) — GET /api/papers?q=<query>&limit=<n>. Backs the "Live Literature"
// rail on the episode detail page, which anchors each episode to current papers.
//
// Resilience contract: mirrors the other proxies — never 500s the page. On any
// failure it returns { items: [], error: true } with HTTP 200 so the rail can
// render its own error state without taking the page down. The exceptions are
// a 400 for out-of-bounds input and a 429 when one IP sends too many requests.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, PAPERS_MAX_PER_WINDOW);

export async function GET(req: Request) {
  const parsed = parsePapersQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ items: [], error: true, message: parsed.message }, { status: 400 });
  }
  const { q, limit } = parsed;
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json(
      { query: q, items: [], error: true, rate_limited: true, message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: retryAfterHeaders() }
    );
  }

  if (!q.trim()) return NextResponse.json({ query: q, items: [] });

  try {
    const res = await fetch(
      `${EXPLORE_API_URL}/api/papers?q=${encodeURIComponent(q)}&limit=${limit}`,
      { cache: "no-store", headers: exploreBackendHeaders() }
    );
    if (!res.ok) throw new Error(`papers backend responded ${res.status}`);

    const data = (await res.json()) as { items?: ExploreItem[]; error?: string };
    if (data.error) throw new Error(data.error);

    return NextResponse.json({ query: q, items: data.items ?? [] });
  } catch {
    return NextResponse.json({ query: q, items: [], error: true }, { status: 200 });
  }
}
