import test from "node:test";
import assert from "node:assert/strict";
import { clientIp, createRateLimiter } from "./rateLimit.ts";
import {
  EXPLORE_BODY_MAX_CHARS,
  EXPLORE_MAX_PER_WINDOW,
  PAPERS_LIMIT_DEFAULT,
  RATE_LIMITED_MESSAGE,
  SEARCH_TEXT_MAX,
  SEARCH_WINDOW_MS,
  parseExploreBody,
  parsePapersQuery,
  retryAfterHeaders,
} from "./searchRequest.ts";

const papers = (qs: string) => parsePapersQuery(new URLSearchParams(qs));

test("parsePapersQuery: limit defaults, and is clamped to 1..25", () => {
  assert.deepEqual(papers("q=egfr"), { ok: true, q: "egfr", limit: PAPERS_LIMIT_DEFAULT });
  assert.deepEqual(papers("q=egfr&limit=8"), { ok: true, q: "egfr", limit: 8 });
  assert.deepEqual(papers("q=egfr&limit=1000"), { ok: true, q: "egfr", limit: 25 });
  assert.deepEqual(papers("q=egfr&limit=0"), { ok: true, q: "egfr", limit: 1 });
  assert.deepEqual(papers("q=egfr&limit=-5"), { ok: true, q: "egfr", limit: 1 });
  assert.deepEqual(papers("q=egfr&limit=3.9"), { ok: true, q: "egfr", limit: 3 });
});

test("parsePapersQuery: a non-numeric limit or over-long text is rejected", () => {
  assert.equal(papers("q=egfr&limit=abc").ok, false);
  assert.equal(papers(`q=${"a".repeat(SEARCH_TEXT_MAX + 1)}`).ok, false);
  assert.equal(papers(`q=${"a".repeat(SEARCH_TEXT_MAX)}`).ok, true);
});

test("parseExploreBody: keeps the fields the route used before", () => {
  const r = parseExploreBody(
    JSON.stringify({ input: "KRAS", personalize: false, project_id: "p1", since_year: 2020, status_filter: ["RECRUITING", "", 3], only_kinds: ["grant"] })
  );
  assert.deepEqual(r, {
    ok: true,
    input: "KRAS",
    personalize: false,
    projectId: "p1",
    sinceYear: 2020,
    statusFilter: ["RECRUITING"],
    onlyKinds: ["grant"],
  });
});

test("parseExploreBody: malformed or empty JSON still means the landing feed", () => {
  for (const raw of ["", "{nope", "null", "42"]) {
    const r = parseExploreBody(raw);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.input, "");
      assert.equal(r.personalize, true);
    }
  }
});

test("parseExploreBody: over-long input, project_id or body is rejected", () => {
  assert.equal(parseExploreBody(JSON.stringify({ input: "a".repeat(SEARCH_TEXT_MAX + 1) })).ok, false);
  assert.equal(parseExploreBody(JSON.stringify({ input: "a".repeat(SEARCH_TEXT_MAX) })).ok, true);
  assert.equal(parseExploreBody(JSON.stringify({ project_id: "x".repeat(65) })).ok, false);
  assert.equal(parseExploreBody(" ".repeat(EXPLORE_BODY_MAX_CHARS + 1)).ok, false);
});

test("parseExploreBody: filter lists are bounded", () => {
  const r = parseExploreBody(JSON.stringify({ status_filter: Array(50).fill("RECRUITING"), only_kinds: ["x".repeat(100)] }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.statusFilter?.length, 20);
    assert.equal(r.onlyKinds, undefined);
  }
});

test("search limiter: normal browsing fits, a burst past the limit is refused", () => {
  const limiter = createRateLimiter(SEARCH_WINDOW_MS, EXPLORE_MAX_PER_WINDOW);
  const t0 = 1_000_000;
  for (let i = 0; i < EXPLORE_MAX_PER_WINDOW; i++) assert.equal(limiter.limited("ip", t0 + i), false);
  assert.equal(limiter.limited("ip", t0 + 100), true);
  assert.equal(limiter.limited("other-ip", t0 + 100), false);
  assert.equal(limiter.limited("ip", t0 + SEARCH_WINDOW_MS + 100), false);
});

test("retryAfterHeaders and the message read differently from no results", () => {
  assert.equal(retryAfterHeaders()["Retry-After"], "60");
  assert.match(RATE_LIMITED_MESSAGE, /too many searches/i);
  assert.doesNotMatch(RATE_LIMITED_MESSAGE, /no results/i);
});

test("clientIp: prefers the platform-set headers over x-forwarded-for", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });
  assert.equal(clientIp(req({ "x-vercel-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" })), "1.1.1.1");
  assert.equal(clientIp(req({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9" })), "2.2.2.2");
  assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), "9.9.9.9");
  assert.equal(clientIp(req({})), "unknown");
});
