// Explore results as a stream (#95): POST /api/explore/stream sends NDJSON,
// one event per line, from backend/explore-mcp (tools/explore.explore_stream):
//   {"type":"meta", input, scope, tools_called, reasoning, pending_kinds[, interpreted]}
//   {"type":"section", "section": {...}}   one per source, as it finishes
//   {"type":"done", "complete": bool, "cached": bool[, "error": string]}
// `done` is always last. Used by the Next proxy (relayExploreStream) and the
// topic page (streamExplore). No runtime imports, so both can use it.

import type { ExploreResponse, ExploreScope, ExploreSection } from "@/types/explore";

export type ExploreMetaEvent = {
  type: "meta";
  input?: string;
  scope?: ExploreScope;
  tools_called?: string[];
  reasoning?: string | null;
  pending_kinds?: string[];
  interpreted?: unknown;
};
export type ExploreSectionEvent = { type: "section"; section: ExploreSection };
export type ExploreDoneEvent = { type: "done"; complete: boolean; cached?: boolean; error?: string | boolean };
export type ExploreStreamEvent = ExploreMetaEvent | ExploreSectionEvent | ExploreDoneEvent;

/** A page's results while they stream in: the usual response plus the kinds
 *  still being searched. */
export type StreamingExplore = ExploreResponse & { pending_kinds?: string[] };

function asEvent(value: unknown): ExploreStreamEvent | null {
  if (!value || typeof value !== "object") return null;
  const e = value as { type?: unknown; section?: unknown };
  if (e.type === "meta" || e.type === "done") return value as ExploreStreamEvent;
  if (e.type === "section" && e.section && typeof e.section === "object") return value as ExploreSectionEvent;
  return null;
}

/** Splits NDJSON text into events. Chunks can end mid-line (or mid-character,
 *  for the decoder): the rest is kept until the next push. Lines that are not
 *  a known event are skipped. */
export function createNdjsonParser() {
  let buffer = "";
  const parseLine = (line: string): ExploreStreamEvent | null => {
    const text = line.trim();
    if (!text) return null;
    try {
      return asEvent(JSON.parse(text));
    } catch {
      return null;
    }
  };
  return {
    push(chunk: string): ExploreStreamEvent[] {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return lines.map(parseLine).filter((e): e is ExploreStreamEvent => e !== null);
    },
    flush(): ExploreStreamEvent[] {
      const last = parseLine(buffer);
      buffer = "";
      return last ? [last] : [];
    },
  };
}

export const emptyStreamingExplore = (): StreamingExplore => ({ sections: [], pending_kinds: [] });

/** The page state after one event. Never mutates `state`. */
export function applyStreamEvent(state: StreamingExplore, event: ExploreStreamEvent): StreamingExplore {
  if (event.type === "meta") {
    const { type: _type, ...meta } = event;
    return { ...state, ...meta, pending_kinds: meta.pending_kinds ?? [] };
  }
  if (event.type === "section") {
    const kind = event.section.kind;
    const pending = [...(state.pending_kinds ?? [])];
    const at = pending.indexOf(kind);
    if (at >= 0) pending.splice(at, 1);
    return { ...state, sections: [...state.sections, event.section], pending_kinds: pending };
  }
  return { ...state, pending_kinds: [], ...(event.complete ? {} : { error: true }) };
}

/** Reads a stream body to its end, calling `onUpdate` with the page state
 *  after every event. Returns the final state and the `done` event (null when
 *  the stream ended without one). */
export async function readExploreStream(
  body: ReadableStream<Uint8Array>,
  onUpdate: (state: StreamingExplore) => void,
): Promise<{ state: StreamingExplore; done: ExploreDoneEvent | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createNdjsonParser();
  let state = emptyStreamingExplore();
  let done: ExploreDoneEvent | null = null;
  const take = (events: ExploreStreamEvent[]) => {
    for (const event of events) {
      if (done) return;
      state = applyStreamEvent(state, event);
      if (event.type === "done") done = event;
      onUpdate(state);
    }
  };
  for (;;) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    take(parser.push(decoder.decode(value, { stream: true })));
  }
  take(parser.push(decoder.decode()));
  take(parser.flush());
  return { state, done };
}

/** A stream result the page can keep: it finished, completely, with sections.
 *  Anything else falls back to the non-streaming /api/explore. */
export const streamSucceeded = (state: StreamingExplore, done: ExploreDoneEvent | null) =>
  !!done && done.complete && state.sections.length > 0;

/** Runs a search over /api/explore/stream. Returns the final results, or null
 *  when the caller should fall back to /api/explore (network error, no
 *  stream, the stream broke or ended without results). A 400 / 429 answer is
 *  returned as-is: it carries the message to show, and retrying elsewhere
 *  would only get around the limit. */
export async function streamExplore(
  body: unknown,
  onUpdate: (state: StreamingExplore) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ExploreResponse | null> {
  try {
    const res = await fetchImpl("/api/explore/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 400 || res.status === 429) return (await res.json()) as ExploreResponse;
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !type.includes("ndjson")) return null;
    const { state, done } = await readExploreStream(res.body, onUpdate);
    if (!streamSucceeded(state, done)) return null;
    const { pending_kinds: _pending, ...result } = state;
    return result;
  } catch {
    return null;
  }
}

const encodeEvent = (event: ExploreStreamEvent) => JSON.stringify(event) + "\n";

/** The proxy's pass-through: re-sends each upstream event as its own line as
 *  soon as it is whole, with `mapSection` applied to sections, and always
 *  ends with a `done` (an incomplete one if the upstream broke or stopped
 *  early). Cancelling the returned stream cancels the upstream read. */
export function relayExploreStream(
  upstream: ReadableStream<Uint8Array>,
  mapSection: (section: ExploreSection) => ExploreSection = (s) => s,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parser = createNdjsonParser();
  let sawMeta = false;
  let sawDone = false;
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, events: ExploreStreamEvent[]) => {
    let sent = 0;
    for (const event of events) {
      if (sawDone) break;
      if (event.type === "meta") sawMeta = true;
      if (event.type === "done") sawDone = true;
      const out = event.type === "section" ? { ...event, section: mapSection(event.section) } : event;
      controller.enqueue(encoder.encode(encodeEvent(out)));
      sent++;
    }
    return sent;
  };
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, error?: string) => {
    if (!sawDone) {
      if (!sawMeta) send(controller, [{ type: "meta", scope: {}, tools_called: [], pending_kinds: [] }]);
      send(controller, [{ type: "done", complete: false, cached: false, error: error ?? "stream ended early" }]);
    }
    controller.close();
  };
  return new ReadableStream<Uint8Array>({
    // Reads until at least one whole line is sent: a pull that enqueues
    // nothing is not called again.
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            send(controller, parser.push(decoder.decode()));
            send(controller, parser.flush());
            finish(controller);
            return;
          }
          const sent = send(controller, parser.push(decoder.decode(value, { stream: true })));
          if (sawDone) {
            controller.close();
            await reader.cancel().catch(() => {});
            return;
          }
          if (sent > 0) return;
        }
      } catch {
        finish(controller, "upstream error");
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
