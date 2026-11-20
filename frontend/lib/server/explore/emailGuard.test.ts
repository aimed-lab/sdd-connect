// Run with `npm test`. Explore never searches text with an email address: the search
// boxes hand it to the assistant, a direct /explore/<email> visit shows a notice, and
// /api/explore + /api/explore/stream refuse it (lib/server/explore/emailGuard.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPLORE_EMAIL_MESSAGE, decodeTopicParam, exploreTextHasEmail, topicParamHasEmail } from "./emailGuard.ts";
import {
  HANDOFF_TTL_MS,
  TYPED_SEARCH_EVENT,
  ASSISTANT_EVENT,
  parseAssistantRequest,
  parseStoredTypedSearch,
  parseTypedSearchHandoff,
  shouldHandOffSearch,
} from "../assistant/assistantBridge.ts";
import { buildAssistantContext, exploreQueryFromPath } from "../assistant/assistantReply.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const TYPED = "can u add test-delete-me@example.com to AI for DD team";

// ── the guard ────────────────────────────────────────────────────────────────

test("the guard: an email anywhere in the text, plain or percent-encoded in the URL", () => {
  assert.equal(exploreTextHasEmail(TYPED), true);
  assert.equal(exploreTextHasEmail("KRAS pancreatic cancer"), false);
  assert.equal(exploreTextHasEmail("CD4+ T cells @ 37C"), false);
  assert.equal(topicParamHasEmail("add%20test-delete-me%40example.com%20to%20a%20team"), true);
  assert.equal(topicParamHasEmail("add test-delete-me@example.com to a team"), true); // already decoded
  assert.equal(topicParamHasEmail("add%2520x%2540y.org"), true); // encoded twice
  assert.equal(topicParamHasEmail("KRAS%20pancreatic%20cancer"), false);
  assert.equal(topicParamHasEmail("100%25%20bad%"), false); // invalid encoding does not throw
  assert.equal(decodeTopicParam("KRAS%20pancreatic%20cancer"), "KRAS pancreatic cancer");
});

// ── a typed query with an email is handed to the assistant, never a URL ─────

test("search box: email text is handed to the assistant before onSubmit; normal text still searches", () => {
  assert.equal(shouldHandOffSearch(TYPED), true);
  assert.equal(shouldHandOffSearch("KRAS pancreatic cancer"), false);

  const src = read("components/explore/QuestionBox.tsx");
  const submitAt = src.indexOf("onSubmit={(e) => {");
  const handAt = src.indexOf("if (shouldHandOffSearch(q)) {", submitAt);
  const searchAt = src.indexOf("onSubmit(q, scope);", submitAt);
  assert.ok(submitAt > 0 && handAt > submitAt && searchAt > handAt, "the hand-off comes before the search");
  // The hand-off branch returns without calling onSubmit (no URL, no search).
  const branch = src.slice(handAt, searchAt);
  assert.match(branch, /handOffTypedSearch\(q, panelHere\);/);
  assert.match(branch, /return;\s+\}/);
  assert.ok(!/onSubmit\(/.test(branch));
  assert.ok(!branch.includes("/explore/"));
  // Example chips are not typed text: they still call onSubmit directly, never the hand-off.
  assert.match(src, /onClick=\{\(\) => onSubmit\(t, scope\)\}/);
  assert.equal((src.match(/handOffTypedSearch\(/g) ?? []).length, 1);
});

test("every typed Explore search box is this one component", () => {
  for (const f of ["app/explore/page.tsx", "components/home/HomeQuestionBox.tsx"]) {
    assert.match(read(f), /<QuestionBox[\s\S]*?onSubmit=/, f);
  }
  // the results page (not edited here) uses it too
  assert.match(read("app/explore/[topic]/page.tsx"), /<QuestionBox/);
});

// ── the typed hand-off is narrow and separate from chips, starters and links ─

test("hand-off event: its own name, source search_box, and only text with an email", () => {
  assert.notEqual(TYPED_SEARCH_EVENT, ASSISTANT_EVENT);
  assert.deepEqual(parseTypedSearchHandoff({ source: "search_box", text: ` ${TYPED} ` }), { text: TYPED });
  assert.equal(parseTypedSearchHandoff({ source: "chip", text: TYPED }), null);
  assert.equal(parseTypedSearchHandoff({ text: TYPED }), null);
  assert.equal(parseTypedSearchHandoff({ source: "search_box", text: "KRAS" }), null); // no email: not this path
  assert.equal(parseTypedSearchHandoff(null), null);
  // The generic bridge never carries "typed".
  assert.deepEqual(parseAssistantRequest({ mode: "send", text: TYPED, typed: true }), { text: TYPED, mode: "send" });
});

test("stored hand-off (home page -> /explore): read once, within a minute", () => {
  const now = 1_000_000;
  const stored = (at: number, extra: object = {}) => JSON.stringify({ source: "search_box", text: TYPED, at, ...extra });
  assert.deepEqual(parseStoredTypedSearch(stored(now - 5_000), now), { text: TYPED });
  assert.equal(parseStoredTypedSearch(stored(now - HANDOFF_TTL_MS - 1), now), null);
  assert.equal(parseStoredTypedSearch(stored(now + 10), now), null);
  assert.equal(parseStoredTypedSearch(stored(now, { source: "link" }), now), null);
  assert.equal(parseStoredTypedSearch("not json", now), null);
  assert.equal(parseStoredTypedSearch(null, now), null);
});

test("the panel sends the hand-off as typed; the generic bridge stays not typed", () => {
  const src = read("components/explore/AssistantChat.tsx");
  assert.match(src, /window\.addEventListener\(TYPED_SEARCH_EVENT, on\)/);
  assert.match(src, /void send\(h\.text, \{ typed: true, stay: true \}\);/);
  // the generic ASSISTANT_EVENT path still sends without typed
  assert.match(src, /else if \(req\.mode === "send"\) void send\(req\.text, \{ stay: req\.stay \}\);/);
  // typed: true appears only for the input box (2) and this hand-off (1)
  assert.equal((src.match(/send\([^)]*typed: true/g) ?? []).length, 3);
});

// ── direct visits ────────────────────────────────────────────────────────────

test("direct visit: the layout shows the notice instead of the page, and the title leaves the text out", () => {
  const src = read("app/explore/[topic]/layout.tsx");
  assert.match(src, /if \(topicParamHasEmail\(topic\)\) return <EmailQueryNotice \/>;\s+return children;/);
  assert.match(src, /if \(topicParamHasEmail\(topic\)\) return \{ title: "Explore"/);
  const notice = read("components/explore/EmailQueryNotice.tsx");
  assert.match(notice, /EXPLORE_EMAIL_NOTICE/);
  assert.match(notice, /openAssistant\(\{ text: "", mode: "open" \}\)/); // opens only, hands nothing over
  for (const banned of ["fetch(", "streamExplore", "Follow this topic", "saveAsLivingPageMessage", "router.push"]) {
    assert.ok(!notice.includes(banned), banned);
  }
});

test("the assistant never takes an email-bearing topic from the URL as context", () => {
  assert.equal(exploreQueryFromPath("/explore/add%20test-delete-me%40example.com%20to%20a%20team"), "");
  assert.equal(exploreQueryFromPath("/explore/KRAS%20pancreatic%20cancer"), "KRAS pancreatic cancer");
  assert.deepEqual(buildAssistantContext({ query: "add x@y.org to a team" }), {});
  assert.deepEqual(buildAssistantContext({ query: "KRAS" }), { query: "KRAS" });
});

// ── the API backstop ─────────────────────────────────────────────────────────

test("both search routes refuse an email before the backend call", () => {
  const helper = read("lib/server/explore/explorePayload.ts");
  const guard = helper.indexOf("if (exploreTextHasEmail(parsed.input)) {");
  assert.ok(guard > 0);
  assert.ok(guard < helper.indexOf("getProject(projectId)"), "before anything else is looked up");
  assert.match(helper.slice(guard), /return \{ ok: false, status: 400, message: EXPLORE_EMAIL_MESSAGE \};/);
  assert.match(EXPLORE_EMAIL_MESSAGE, /doesn't search email addresses/);
  for (const route of ["app/api/explore/route.ts", "app/api/explore/stream/route.ts"]) {
    const src = read(route);
    const prep = src.indexOf("await buildExplorePayload(req, limiter)");
    const backend = src.indexOf("fetch(`${EXPLORE_API_URL}");
    assert.ok(prep > 0 && backend > prep, route);
    assert.match(src.slice(prep, backend), /if \(!prepared\.ok\) \{[\s\S]*?status: 400/, route);
  }
});
