import { NextResponse } from "next/server";
import { getAllProviders } from "@/lib/server/providers/providers";
import { clientIp, createRateLimiter } from "@/lib/server/rateLimit";
import { RATE_LIMITED_MESSAGE, SEARCH_WINDOW_MS, retryAfterHeaders } from "@/lib/server/searchRequest";
import { PROVIDERS_MAX_PER_WINDOW, parseProvidersQuery, providersBody } from "@/lib/server/publicData";

// GET /api/providers[?capability=<id>&q=<text>&limit=<n>] -> the Service
// Providers directory as read-only JSON (see lib/server/publicData.ts). No
// contact details. 400 for out-of-bounds input, 429 (with Retry-After) when
// one IP sends too many requests.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, PROVIDERS_MAX_PER_WINDOW);

export async function GET(req: Request) {
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json(
      { providers: [], error: true, rate_limited: true, message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: retryAfterHeaders() }
    );
  }
  const url = new URL(req.url);
  const parsed = parseProvidersQuery(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ providers: [], error: true, message: parsed.message }, { status: 400 });
  }
  const { q, capability, limit } = parsed;
  return NextResponse.json(providersBody(getAllProviders(), { q, capability, limit }, url.origin));
}
