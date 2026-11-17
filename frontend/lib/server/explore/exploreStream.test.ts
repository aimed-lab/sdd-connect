// Run with `npm test`. Explore streaming (#95): the NDJSON parser (partial
// lines and characters split across chunks), the page state built from the
// events, when the page falls back to /api/explore, and the proxy relay.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStreamEvent,
  createNdjsonParser,
  emptyStreamingExplore,
  readExploreStream,
  relayExploreStream,
  streamExplore,
  type ExploreStreamEvent,
  type StreamingExplore,
} from "./exploreStream.ts";

const enc = new TextEncoder();
const line = (e: unknown) => JSON.stringify(e) + "\n";
const META = { type: "meta", input: "kras", scope: {}, tools_called: ["search_papers", "search_trials"], pending_kinds: ["paper", "trial"] };
const section = (kind: string, n = 1) => ({
  type: "section",
  section: { tool: `search_${kind}s`, kind, items: Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, kind, title: `  ${kind}   ${i} ` })) },
});
const DONE = { type: "done", complete: true, cached: false };

function streamOf(chunks: (string | Uint8Array)[], failAfter?: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && i === failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const c = chunks[i++];
      controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
    },
  });
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out + dec.decode();
    out += dec.decode(value, { stream: true });
  }
}

// ── parser ───────────────────────────────────────────────────────────────────

test("parser keeps a partial line until the rest arrives", () => {
  const p = createNdjsonParser();
  const text = line(META) + line(section("paper"));
  const cut = text.length - 10;
  const first = p.push(text.slice(0, cut));
  assert.deepEqual(first.map((e) => e.type), ["meta"]);
  const second = p.push(text.slice(cut));
  assert.deepEqual(second.map((e) => e.type), ["section"]);
  assert.deepEqual(p.flush(), []);
});

test("parser handles many events in one chunk, blank lines and a last line without newline", () => {
  const p = createNdjsonParser();
  const events = p.push(line(META) + "\n\n" + line(section("paper")) + JSON.stringify(DONE));
  assert.deepEqual(events.map((e) => e.type), ["meta", "section"]);
  assert.deepEqual(p.flush().map((e) => e.type), ["done"]);
});

test("parser skips lines that are not events", () => {
  const p = createNdjsonParser();
  const events = p.push('not json\n{"type":"other"}\n{"type":"section"}\n' + line(DONE));
  assert.deepEqual(events.map((e) => e.type), ["done"]);
});

test("a multi-byte character split across chunks survives", async () => {
  const bytes = enc.encode(line({ ...META, input: "β-catenin" }) + line(DONE));
  const at = bytes.indexOf(0xce) + 1; // inside the two bytes of "β"
  const updates: StreamingExplore[] = [];
  const { state, done } = await readExploreStream(streamOf([bytes.slice(0, at), bytes.slice(at)]), (s) => updates.push(s));
  assert.equal(state.input, "β-catenin");
  assert.equal(done?.complete, true);
  assert.equal(updates.length, 2);
});

// ── page state ───────────────────────────────────────────────────────────────

test("sections are appended as they arrive and leave the pending list", () => {
  let s = emptyStreamingExplore();
  s = applyStreamEvent(s, META as ExploreStreamEvent);
  assert.deepEqual(s.pending_kinds, ["paper", "trial"]);
  assert.deepEqual(s.tools_called, ["search_papers", "search_trials"]);
  s = applyStreamEvent(s, section("trial") as ExploreStreamEvent);
  assert.deepEqual(s.pending_kinds, ["paper"]);
  assert.deepEqual(s.sections.map((x) => x.kind), ["trial"]);
  s = applyStreamEvent(s, section("paper") as ExploreStreamEvent);
  s = applyStreamEvent(s, DONE as ExploreStreamEvent);
  assert.deepEqual(s.pending_kinds, []);
  assert.equal(s.error, undefined);
  assert.equal("type" in s, false);
});

test("an incomplete done marks the result as an error", () => {
  const s = applyStreamEvent(emptyStreamingExplore(), { type: "done", complete: false, error: "x" });
  assert.equal(s.error, true);
});

test("readExploreStream reports every step and the done event", async () => {
  const updates: number[] = [];
  const body = streamOf([line(META), line(section("paper")).slice(0, 5), line(section("paper")).slice(5), line(DONE)]);
  const { state, done } = await readExploreStream(body, (s) => updates.push(s.sections.length));
  assert.deepEqual(updates, [0, 1, 1]);
  assert.equal(state.sections.length, 1);
  assert.equal(done?.cached, false);
});

// ── streamExplore and the fallback decision ──────────────────────────────────

const ndjson = (text: string, status = 200) =>
  new Response(text, { status, headers: { "Content-Type": "application/x-ndjson" } });
const fakeFetch = (res: Response | Error) =>
  (async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;

test("a complete stream returns the result without pending_kinds", async () => {
  const seen: number[] = [];
  const out = await streamExplore({ input: "kras" }, (s) => seen.push(s.sections.length), undefined,
    fakeFetch(ndjson(line(META) + line(section("paper", 2)) + line(section("trial")) + line(DONE))));
  assert.ok(out);
  assert.deepEqual(out.sections.map((s) => s.kind), ["paper", "trial"]);
  assert.equal("pending_kinds" in out, false);
  assert.deepEqual(seen, [0, 1, 2, 2]);
});

test("falls back (null) on a network error, a non-stream answer, a missing or incomplete done, or no sections", async () => {
  const cases: (Response | Error)[] = [
    new TypeError("fetch failed"),
    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    ndjson("bad gateway", 502),
    ndjson(line(META) + line(section("paper"))), // ended without done
    ndjson(line(META) + line(section("paper")) + line({ type: "done", complete: false, error: "boom" })),
    ndjson(line(META) + line(DONE)), // zero sections
  ];
  for (const c of cases) {
    assert.equal(await streamExplore({}, () => {}, undefined, fakeFetch(c)), null);
  }
});

test("a broken connection mid-stream falls back", async () => {
  const res = new Response(streamOf([line(META), line(section("paper"))], 2), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  assert.equal(await streamExplore({}, () => {}, undefined, fakeFetch(res)), null);
});

test("400 and 429 answers are returned as they are, not retried", async () => {
  const body = { sections: [], scope: {}, error: true, rate_limited: true, message: "Too many searches." };
  const res = new Response(JSON.stringify(body), { status: 429, headers: { "Content-Type": "application/json" } });
  const out = await streamExplore({}, () => {}, undefined, fakeFetch(res));
  assert.equal(out?.rate_limited, true);
  assert.equal(out?.message, "Too many searches.");
});

// ── proxy relay ──────────────────────────────────────────────────────────────

test("relay re-sends whole lines and maps sections", async () => {
  const text = line(META) + line(section("paper")) + line(DONE);
  const chunks = [text.slice(0, 7), text.slice(7, 60), text.slice(60)];
  const out = await readAll(
    relayExploreStream(streamOf(chunks), (s) => ({ ...s, items: s.items.map((i) => ({ ...i, title: i.title.trim() })) }))
  );
  const events = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ["meta", "section", "done"]);
  assert.equal(events[1].section.items[0].title, "paper   0");
});

test("relay ends with an incomplete done when the upstream breaks or stops early", async () => {
  const broken = await readAll(relayExploreStream(streamOf([line(META), line(section("paper"))], 2)));
  const a = broken.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(a.map((e) => e.type), ["meta", "section", "done"]);
  assert.equal(a[2].complete, false);

  const empty = await readAll(relayExploreStream(streamOf([])));
  const b = empty.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(b.map((e) => e.type), ["meta", "done"]);
  assert.equal(b[1].complete, false);
});

test("relay sends nothing after done", async () => {
  const out = await readAll(relayExploreStream(streamOf([line(META) + line(DONE) + line(section("paper"))])));
  assert.deepEqual(out.trim().split("\n").map((l) => JSON.parse(l).type), ["meta", "done"]);
});

test("cancelling the relay cancels the upstream read", async () => {
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(line(META)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const relay = relayExploreStream(upstream);
  const reader = relay.getReader();
  await reader.read();
  await reader.cancel("client left");
  assert.equal(cancelled, true);
});
