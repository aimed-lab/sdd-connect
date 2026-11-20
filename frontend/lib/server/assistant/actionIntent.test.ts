// Run with `npm test`. "add <email> to <team or project>" in the Explore assistant:
// the strict parser, the model-extraction gate and checks, target matching and the
// role filter (lib/server/assistant/actionIntent.ts, actionTargets.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADD_MEMBER_REPLY,
  EMAIL_HELP_REPLY,
  acceptExtractedIntent,
  addMemberReplyFor,
  emailIsInMessage,
  hasEmailAddress,
  messagesForResearch,
  parseAddMemberIntent,
  routeForMessage,
  targetIsInMessage,
} from "./actionIntent.ts";
import { canAddMembersTo, matchTargets, noTargetMessage, projectCode, type TargetRow } from "./actionTargets.ts";

// ── the strict parser ────────────────────────────────────────────────────────

test("parser: the four required phrasings", () => {
  assert.deepEqual(parseAddMemberIntent("add xyz@gmail.com to ABCD team"), {
    kind: "add_member",
    email: "xyz@gmail.com",
    targetName: "ABCD",
    targetType: "team",
  });
  assert.deepEqual(parseAddMemberIntent("add xyz@gmail.com to the C-103 project"), {
    kind: "add_member",
    email: "xyz@gmail.com",
    targetName: "C-103",
    targetType: "project",
  });
  assert.deepEqual(parseAddMemberIntent("can you put xyz@gmail.com in my ABCD team"), {
    kind: "add_member",
    email: "xyz@gmail.com",
    targetName: "ABCD",
    targetType: "team",
  });
  assert.deepEqual(parseAddMemberIntent("invite xyz@gmail.com to ABCD"), {
    kind: "add_member",
    email: "xyz@gmail.com",
    targetName: "ABCD",
    targetType: null,
  });
});

test("parser: other clear wordings", () => {
  const p = (t: string) => parseAddMemberIntent(t);
  assert.equal(p("Please add Jane.Doe+lab@uab.edu to the Neuro Onc Lab team.")?.targetName, "Neuro Onc Lab");
  assert.equal(p("Please add Jane.Doe+lab@uab.edu to the Neuro Onc Lab team.")?.email, "Jane.Doe+lab@uab.edu");
  assert.equal(p("could you add xyz@gmail.com to project Kinase Screen")?.targetType, "project");
  assert.equal(p("could you add xyz@gmail.com to project Kinase Screen")?.targetName, "Kinase Screen");
  assert.equal(p("add xyz@gmail.com as a member to ABCD")?.targetName, "ABCD");
  assert.equal(p("add xyz@gmail.com to ABCD please")?.targetName, "ABCD");
  assert.equal(p("I'd like to invite xyz@gmail.com into ABCD team!")?.targetName, "ABCD");
});

test("parser: not a clear request -> null (stays a research question)", () => {
  for (const t of [
    "papers on adding PEG to antibodies",
    "add ABCD to my team",
    "add xyz@gmail.com",
    "add xyz@gmail.com to my team",
    "add xyz@gmail.com to ABCD or EFGH",
    "add xyz@gmail.com and abc@gmail.com to ABCD",
    "what does add xyz@gmail.com to ABCD team mean in this paper about onboarding",
    "remove xyz@gmail.com from ABCD team",
    "",
  ]) {
    assert.equal(parseAddMemberIntent(t), null, t);
  }
});

// ── the email must be in the message ─────────────────────────────────────────

test("emailIsInMessage: exact (ignoring case), well formed", () => {
  assert.equal(emailIsInMessage("xyz@gmail.com", "add xyz@gmail.com to ABCD"), true);
  assert.equal(emailIsInMessage("XYZ@Gmail.com", "add xyz@gmail.com to ABCD"), true);
  assert.equal(emailIsInMessage("xyz@gmail.co", "add xyz@gmail.com to ABCD"), false); // a prefix is not the address
  assert.equal(emailIsInMessage("abc@gmail.com", "add xyz@gmail.com to ABCD"), false);
  assert.equal(emailIsInMessage("not-an-email", "add not-an-email to ABCD"), false);
  assert.equal(emailIsInMessage("", "add xyz@gmail.com"), false);
});

test("routing: any typed message with an email goes to extraction, never to research", () => {
  const casual = "hey can u pls get test-delete-me@example.com into c-106 so she can see the files";
  assert.equal(routeForMessage(casual, true), "extract"); // no add / invite / put word needed
  assert.equal(routeForMessage("what is the email format for test-delete-me@example.com", true), "extract");
  assert.equal(routeForMessage("add a@b.com and c@d.com to ABCD", true), "extract");
  // not typed by the person (a chip, another page): no extraction, and still no research
  assert.equal(routeForMessage(casual, false), "help");
  // no email: research as usual
  assert.equal(routeForMessage("add PEG to antibodies", true), "research");
  assert.equal(routeForMessage("EGFR inhibitors in glioma", false), "research");
  assert.equal(hasEmailAddress("ping me at x@y.org"), true);
  assert.equal(hasEmailAddress("no address here @ all"), false);
});

test("the casual sentence: the model's extraction is accepted and finds the C-106 project", () => {
  const msg = "hey can u pls get test-delete-me@example.com into c-106 so she can see the files";
  assert.equal(parseAddMemberIntent(msg), null); // the strict parser misses it; the model is asked
  // What the extraction route's model returns for it, checked against the message:
  const intent = acceptExtractedIntent({ email: "test-delete-me@example.com", target_name: "c-106", target_type: null }, msg);
  assert.deepEqual(intent, { kind: "add_member", email: "test-delete-me@example.com", targetName: "c-106", targetType: null });
  // ...and a model that rewrote the code or the address is refused.
  assert.equal(acceptExtractedIntent({ email: "test-delete-me@example.com", target_name: "C-107" }, msg), null);
  const rows: TargetRow[] = [
    { type: "project", id: "p106", name: "Glioma Atlas", slug: null, memberCount: 5, role: "manager", code: "C-106" },
    { type: "project", id: "p107", name: "Other", slug: null, memberCount: 2, role: "lead", code: "C-107" },
  ];
  const m = matchTargets(rows, intent!.targetName, intent!.targetType);
  assert.deepEqual(m.candidates.map((c) => c.id), ["p106"]);
  assert.equal(addMemberReplyFor({ kind: "candidates", count: m.candidates.length }), ADD_MEMBER_REPLY);
});

test("a message with an email that is not an add request never reaches the search", () => {
  const msg = "what is the email format for test-delete-me@example.com";
  assert.equal(routeForMessage(msg, true), "extract");
  // The model finds no request: the panel answers with the help line, no research.
  assert.equal(acceptExtractedIntent({ email: null, target_name: null, target_type: null }, msg), null);
  assert.match(EMAIL_HELP_REPLY, /add someone to a team or project you lead/);
  assert.match(EMAIL_HELP_REPLY, /add name@example\.org to the ABCD team/);
  // Earlier messages with an address (and their replies) are not sent with a later question.
  const history = [
    { role: "user", content: "add a@b.com to ABCD" },
    { role: "assistant", content: "Here's what I'd do." },
    { role: "user", content: "EGFR inhibitors" },
  ];
  assert.deepEqual(messagesForResearch(history), [{ role: "user", content: "EGFR inhibitors" }]);
  assert.deepEqual(
    messagesForResearch([
      { role: "assistant", content: "Hi" },
      { role: "user", content: "glioma" },
      { role: "assistant", content: "Found" },
    ]).length,
    3
  );
});

test("no match: the line above the card is not the confirm line", () => {
  const none = addMemberReplyFor({ kind: "none", message: "You don't lead a team or project called Zebra Lab." });
  assert.ok(!none.includes("Confirm") || !none.includes("press Confirm. Nothing"), none);
  assert.notEqual(none, ADD_MEMBER_REPLY);
  assert.match(none, /You don't lead a team or project called Zebra Lab\./);
  assert.match(none, /add someone to a team or project you lead/);
  assert.ok(!addMemberReplyFor({ kind: "candidates", count: 0 }).includes("Check it, then press Confirm"));
  assert.ok(!addMemberReplyFor({ kind: "error", message: "Sign in first." }).includes("Check it, then press Confirm"));
  // Several matches: still something to confirm.
  assert.match(addMemberReplyFor({ kind: "candidates", count: 3 }), /Pick one, then press Confirm/);
});

test("model extraction: refused unless the email AND the name are in the message", () => {
  const msg = "hey, xyz@gmail.com should be added to the ABCD group thanks";
  assert.deepEqual(acceptExtractedIntent({ email: "xyz@gmail.com", target_name: "ABCD", target_type: null }, msg), {
    kind: "add_member",
    email: "xyz@gmail.com",
    targetName: "ABCD",
    targetType: null,
  });
  // an email the model made up, or changed
  assert.equal(acceptExtractedIntent({ email: "attacker@evil.com", target_name: "ABCD" }, msg), null);
  assert.equal(acceptExtractedIntent({ email: "xyz@gmail.co", target_name: "ABCD" }, msg), null);
  // a target the message never names
  assert.equal(acceptExtractedIntent({ email: "xyz@gmail.com", target_name: "Other Lab" }, msg), null);
  // a name that is only part of a word is not "in the message"
  assert.equal(acceptExtractedIntent({ email: "xyz@gmail.com", target_name: "ABC" }, msg), null);
  // junk
  assert.equal(acceptExtractedIntent(null, msg), null);
  assert.equal(acceptExtractedIntent({ email: null, target_name: null }, msg), null);
  assert.equal(acceptExtractedIntent("xyz@gmail.com", msg), null);
  // an unknown type is dropped, not trusted
  assert.equal(acceptExtractedIntent({ email: "xyz@gmail.com", target_name: "ABCD", target_type: "community" }, msg)?.targetType, null);
  assert.equal(targetIsInMessage("C-103", "please include xyz@gmail.com on C-103 as well"), true);
});

// ── target matching and the role filter ──────────────────────────────────────

const row = (o: Partial<TargetRow> & Pick<TargetRow, "type" | "id" | "name" | "role">): TargetRow => ({
  slug: o.type === "team" ? o.id : null,
  memberCount: 3,
  code: null,
  ...o,
});

const ROWS: TargetRow[] = [
  row({ type: "team", id: "t1", name: "ABCD", role: "admin" }),
  row({ type: "team", id: "t2", name: "ABCD Lab", role: "admin" }),
  row({ type: "team", id: "t3", name: "Journal Club", role: "member" }),
  row({ type: "project", id: "p1", name: "Kinase Screen", role: "lead" }),
  row({ type: "project", id: "p2", name: "Glioma Atlas", role: "manager", code: "C-103" }),
  row({ type: "project", id: "p3", name: "Organoids", role: "member" }),
  row({ type: "project", id: "p4", name: "ABCD", role: "lead" }),
];

test("canAddMembersTo: team admin; project lead or manager", () => {
  assert.equal(canAddMembersTo({ type: "team", role: "admin" }), true);
  assert.equal(canAddMembersTo({ type: "team", role: "lead" }), false); // the server checks is_community_admin
  assert.equal(canAddMembersTo({ type: "team", role: "member" }), false);
  assert.equal(canAddMembersTo({ type: "project", role: "lead" }), true);
  assert.equal(canAddMembersTo({ type: "project", role: "manager" }), true);
  assert.equal(canAddMembersTo({ type: "project", role: "member" }), false);
});

test("matching: one exact match, with the type the message gave", () => {
  const m = matchTargets(ROWS, "ABCD", "team");
  assert.deepEqual(m.candidates.map((c) => c.id), ["t1"]); // exact beats "ABCD Lab"
  assert.equal(m.candidates[0].href, "/teams/t1");
  assert.equal(matchTargets(ROWS, "the kinase screen project", "project").candidates[0].href, "/projects/p1");
});

test("matching: the CollaboFest code", () => {
  const m = matchTargets(ROWS, "C-103", "project");
  assert.deepEqual(m.candidates.map((c) => c.id), ["p2"]);
  assert.equal(matchTargets(ROWS, "c-103", null).candidates[0].id, "p2");
  assert.equal(projectCode("CollaboFest 2026 · C-103\nMore text"), "C-103");
  assert.equal(projectCode("No code here"), null);
});

test("matching: several matches are all returned (the card shows a picker)", () => {
  // No type given: the team ABCD and the project ABCD are both exact.
  const m = matchTargets(ROWS, "ABCD", null);
  assert.deepEqual(m.candidates.map((c) => `${c.type}:${c.id}`), ["team:t1", "project:p4"]);
  // Only partial matches: every one is offered.
  const lab = matchTargets([row({ type: "team", id: "x1", name: "Glioma Lab A", role: "admin" }), row({ type: "team", id: "x2", name: "Glioma Lab B", role: "admin" })], "Glioma Lab", "team");
  assert.equal(lab.candidates.length, 2);
});

test("matching: no match, and a match the person can't manage", () => {
  const none = matchTargets(ROWS, "Zebrafish", null);
  assert.deepEqual(none, { candidates: [], notAllowed: [] });
  assert.equal(noTargetMessage("Zebrafish", none), "You don't lead a team or project called Zebrafish.");

  const club = matchTargets(ROWS, "Journal Club", "team");
  assert.equal(club.candidates.length, 0);
  assert.deepEqual(club.notAllowed, [{ type: "team", name: "Journal Club" }]);
  assert.match(noTargetMessage("Journal Club", club), /only its lead can add people/);

  const org = matchTargets(ROWS, "Organoids", null);
  assert.match(noTargetMessage("Organoids", org), /only its leads and the SPARC team/);
});

test("matching: only the person's own rows exist to match; a name elsewhere is never found", () => {
  assert.equal(matchTargets([], "ABCD", null).candidates.length, 0);
});

// ── only the person's own typed message reaches the parser ──────────────────

test("AssistantChat: email messages are routed before any backend call; only typed ones are parsed", () => {
  const src = readFileSync(new URL("../../../components/explore/AssistantChat.tsx", import.meta.url), "utf8");
  const routeAt = src.indexOf("const route = routeForMessage(content, !!opts.typed);");
  const backendAt = src.indexOf('fetch("/api/assistant"');
  assert.ok(routeAt > 0 && backendAt > routeAt, "routing comes before the backend call");
  assert.match(src.slice(routeAt, backendAt), /if \(route !== "research"\) \{[\s\S]*?return;\s+\}/);
  assert.match(src, /if \(route === "extract"\) \{\s+addIntent = parseAddMemberIntent\(content\)/);
  assert.match(src, /messages: messagesForResearch\(next\)/);
  // The confirm line is set from the card's outcome, not before it.
  assert.match(src, /content: addMemberLookingReply\(intent\)/);
  assert.match(src, /addMemberReplyFor\(o\)/);
  assert.ok(!src.includes("content: ADD_MEMBER_REPLY"));
  // Only the input box sends with typed: true.
  const typedCalls = src.match(/send\([^)]*typed: true/g) ?? [];
  // form submit and Enter, plus the one search-box hand-off (TYPED_SEARCH_EVENT)
  assert.equal(typedCalls.length, 3);
  assert.equal((src.match(/send\(input, \{ typed: true \}\)/g) ?? []).length, 2);
  assert.match(src, /void send\(h\.text, \{ typed: true, stay: true \}\)/);
  assert.match(src, /void send\(input, \{ typed: true \}\)/);
  for (const other of ["send(q)", "send(st.text)", "send(text)", "send(CHOICE_INFO[v].label)", "send(req.text, { stay: req.stay })"]) {
    assert.ok(src.includes(other), other);
  }
});

test("/api/assistant refuses a message with an email address before the backend", () => {
  const src = readFileSync(new URL("../../../app/api/assistant/route.ts", import.meta.url), "utf8");
  const guard = src.indexOf("isLocalOnlyMessage(all[all.length - 1].content)");
  assert.ok(guard > 0);
  assert.ok(guard < src.indexOf("fetch(`${EXPLORE_API_URL}/api/assistant-turn`"));
  assert.ok(guard < src.indexOf("projectStatusQuestion("));
  assert.match(src, /const messages = messagesForResearch\(all\)/);
});
