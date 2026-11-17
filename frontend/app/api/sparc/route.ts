import { NextResponse } from "next/server";
import { clientIp, createRateLimiter } from "@/lib/server/rateLimit";
import { RATE_LIMITED_MESSAGE, SEARCH_WINDOW_MS, retryAfterHeaders } from "@/lib/server/searchRequest";
import { SPARC_MAX_PER_WINDOW, sparcBody } from "@/lib/server/publicData";

// GET /api/sparc -> the SPARC Center tools, papers and patents shown on /sparc,
// as read-only JSON (see lib/server/publicData.ts). 429 (with Retry-After)
// when one IP sends too many requests.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, SPARC_MAX_PER_WINDOW);

export async function GET(req: Request) {
  if (limiter.limited(clientIp(req))) {
    return NextResponse.json(
      { error: true, rate_limited: true, message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: retryAfterHeaders() }
    );
  }
  return NextResponse.json(sparcBody());
}
