import { NextResponse } from "next/server";
import { EXPLORE_API_URL, exploreBackendHeaders } from "@/lib/server/exploreBackend";
import { cleanSectionTitles } from "@/lib/server/explore/exploreLayout";
import { buildExplorePayload } from "@/lib/server/explore/explorePayload";
import { relayExploreStream } from "@/lib/server/explore/exploreStream";
import { createRateLimiter } from "@/lib/server/rateLimit";
import { EXPLORE_MAX_PER_WINDOW, SEARCH_WINDOW_MS, retryAfterHeaders } from "@/lib/server/searchRequest";

// Streaming twin of /api/explore (#95): the same request (limits, body,
// project-derived input, personalized landing feed — see ../route.ts), sent
// to the backend's POST /api/explore/stream, whose NDJSON events are passed
// on line by line as they arrive (meta, one section per source, done). See
// lib/server/explore/exploreStream.ts for the events.
//
// /api/explore stays as it is; the topic page falls back to it whenever this
// stream fails. A 400 / 429 here is the same JSON shape /api/explore sends.
// Any failure after that ends the stream with an incomplete `done` instead of
// an HTTP error, so the page knows to fall back.
//
// The browser's abort reaches the backend: req.signal is passed to the
// upstream fetch, so leaving the page closes the backend stream too.

const limiter = createRateLimiter(SEARCH_WINDOW_MS, EXPLORE_MAX_PER_WINDOW);

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BACKEND_TIMEOUT_MS = 55_000;

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

const failedStream = (error: string) =>
  new Response(
    JSON.stringify({ type: "meta", scope: {}, tools_called: [], pending_kinds: [] }) +
      "\n" +
      JSON.stringify({ type: "done", complete: false, cached: false, error }) +
      "\n",
    { status: 200, headers: STREAM_HEADERS }
  );

export async function POST(req: Request) {
  const prepared = await buildExplorePayload(req, limiter);
  if (!prepared.ok) {
    if (prepared.status === 429) {
      return NextResponse.json(
        { sections: [], scope: {}, error: true, rate_limited: true, message: prepared.message },
        { status: 429, headers: retryAfterHeaders() }
      );
    }
    return NextResponse.json({ sections: [], scope: {}, error: true, message: prepared.message }, { status: 400 });
  }

  try {
    const res = await fetch(`${EXPLORE_API_URL}/api/explore/stream`, {
      method: "POST",
      headers: exploreBackendHeaders({ "Content-Type": "application/json", Accept: "application/x-ndjson" }),
      body: JSON.stringify(prepared.payload),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(BACKEND_TIMEOUT_MS)]),
      cache: "no-store",
    });
    if (!res.ok || !res.body) return failedStream(`explore backend responded ${res.status}`);
    return new Response(relayExploreStream(res.body, (s) => cleanSectionTitles([s])[0]), {
      status: 200,
      headers: STREAM_HEADERS,
    });
  } catch {
    return failedStream("explore backend unreachable");
  }
}
