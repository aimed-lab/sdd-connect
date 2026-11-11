// Run with `npm test`. The message a page button hands to the assistant panel.

import test from "node:test";
import assert from "node:assert/strict";
import { START_LIVING_PAGE_MESSAGE, openAssistant, parseAssistantRequest, saveAsLivingPageMessage, shownUserText } from "./assistantBridge.ts";

test("parseAssistantRequest: send by default, fill when asked, junk refused", () => {
  assert.deepEqual(parseAssistantRequest({ text: "  What trials are open?  " }), { text: "What trials are open?", mode: "send" });
  assert.deepEqual(parseAssistantRequest({ text: "Find resources on ", mode: "fill" }), { text: "Find resources on", mode: "fill" });
  assert.deepEqual(parseAssistantRequest({ text: "x", mode: "weird" }), { text: "x", mode: "send" });
  for (const bad of [null, undefined, "text", 5, {}, { text: "" }, { text: "   " }, { text: 4 }]) {
    assert.equal(parseAssistantRequest(bad), null, String(bad));
  }
  assert.equal(parseAssistantRequest({ text: "y".repeat(900) })!.text.length, 500);
});

test("parseAssistantRequest: a team is kept only with a real id, a name and a slug", () => {
  const id = "0b9d7f58-6c5a-4a0e-9d3c-2f1d9a8b7c6e";
  const ok = parseAssistantRequest({ text: "Make a wiki page for my team X about:", mode: "fill", team: { id: id.toUpperCase(), name: "  KRAS   club ", slug: "kras-club-a1b2c3" } });
  assert.deepEqual(ok, { text: "Make a wiki page for my team X about:", mode: "fill", team: { id, name: "KRAS club", slug: "kras-club-a1b2c3" } });
  for (const bad of [
    { id: "nope", name: "X", slug: "x" },
    { id, name: "", slug: "x" },
    { id, name: "X", slug: "../x" },
    { id, name: "X" },
    "team",
  ]) {
    assert.equal("team" in parseAssistantRequest({ text: "hi", team: bad })!, false, JSON.stringify(bad));
  }
});

test("the save flow starts with a wiki-page request naming the topic", () => {
  assert.equal(saveAsLivingPageMessage("  KRAS in pancreatic cancer "), "I'd like to create a wiki page on KRAS in pancreatic cancer");
  assert.match(START_LIVING_PAGE_MESSAGE, /wiki page/);
});

test("shownUserText: the Follow sentence reads 'Follow <topic>'; every other message is unchanged", () => {
  assert.equal(shownUserText(saveAsLivingPageMessage("PHGDH inhibitors")), "Follow PHGDH inhibitors");
  assert.equal(shownUserText(saveAsLivingPageMessage("  KRAS in pancreatic cancer ")), "Follow KRAS in pancreatic cancer");
  // The "Create a wiki page for my research" starter keeps its own wording.
  assert.equal(shownUserText(START_LIVING_PAGE_MESSAGE), START_LIVING_PAGE_MESSAGE);
  for (const other of ["What is known about PHGDH?", "Private", "Create a wiki page on KRAS", "I'd like to create a wiki page on "]) {
    assert.equal(shownUserText(other), other);
  }
});

test("parseAssistantRequest: stay is kept only when it is exactly true", () => {
  assert.deepEqual(parseAssistantRequest({ text: "x", mode: "send", stay: true }), { text: "x", mode: "send", stay: true });
  for (const bad of [false, "true", 1, null, undefined]) {
    assert.equal("stay" in parseAssistantRequest({ text: "x", stay: bad })!, false, String(bad));
  }
});

test("openAssistant does nothing (and does not throw) without a window", () => {
  assert.doesNotThrow(() => openAssistant({ text: "hi", mode: "send" }));
});

test("parseAssistantRequest: open mode needs no text", () => {
  assert.deepEqual(parseAssistantRequest({ text: "", mode: "open" }), { text: "", mode: "open" });
  assert.equal(parseAssistantRequest({ text: "" }), null);
});
