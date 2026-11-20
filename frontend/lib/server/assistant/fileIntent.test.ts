// Run with `npm test`. "add this file to <community, team or project>" in the Explore
// assistant (lib/server/assistant/fileIntent.ts, actionTargets.ts).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FILE_TURN_MARK,
  accessLine,
  acceptExtractedPlace,
  attachProblem,
  defaultTitle,
  fileProblemFor,
  fileReplyFor,
  fileTurnContent,
  isFileTurn,
  parseFilePlaceIntent,
  resultNote,
} from "./fileIntent.ts";
import { allowedPlaces, canAddFileTo, matchTargets, type TargetRow } from "./actionTargets.ts";
import { isLocalOnlyMessage, messagesForResearch } from "./actionIntent.ts";

const place = (t: string | null, type: string | null = null) => ({ kind: "add_file", targetName: t, targetType: type });

// ── the parser, with a file attached ─────────────────────────────────────────

test("parser: the four required examples", () => {
  assert.deepEqual(parseFilePlaceIntent("add this to the Savannah 2026 community"), place("Savannah 2026", "community"));
  assert.deepEqual(parseFilePlaceIntent("put today's ppt in my AI for DD team"), place("AI for DD", "team"));
  assert.deepEqual(parseFilePlaceIntent("share this with C-103"), place("C-103"));
  assert.deepEqual(parseFilePlaceIntent("add this"), place(null));
});

test("parser: no place named", () => {
  for (const t of ["", "upload it please", "share the file", "Add this.", "please add this", "save this file"]) {
    assert.deepEqual(parseFilePlaceIntent(t), place(null), t);
  }
});

test("parser: other clear wordings, and unclear ones left to the model", () => {
  assert.deepEqual(parseFilePlaceIntent("can you upload the slides to project Kinase Screen"), place("Kinase Screen", "project"));
  assert.deepEqual(parseFilePlaceIntent("add it to AI in Medicine team"), place("AI in Medicine", "team"));
  assert.deepEqual(parseFilePlaceIntent("send this to C-106 please"), place("C-106"));
  // not one of the clear phrasings: the model is asked
  assert.equal(parseFilePlaceIntent("this is for the savannah folks"), null);
  assert.equal(parseFilePlaceIntent("add this to ABCD or EFGH"), null);
  assert.equal(parseFilePlaceIntent("add this to it"), null);
});

test("model answer: a name only if the message contains it", () => {
  const msg = "this one is for the savannah 2026 people";
  assert.deepEqual(acceptExtractedPlace({ target_name: "Savannah 2026", target_type: "community" }, msg), place("Savannah 2026", "community"));
  // made up, or junk: no place named (the person picks)
  assert.deepEqual(acceptExtractedPlace({ target_name: "Atlanta 2026" }, msg), place(null));
  assert.deepEqual(acceptExtractedPlace(null, msg), place(null));
  assert.deepEqual(acceptExtractedPlace({ target_name: "Savannah 2026", target_type: "galaxy" }, msg), place("Savannah 2026"));
});

// ── a message with an attachment never reaches research ──────────────────────

test("a file turn is marked, kept out of the research history, and refused by /api/assistant", () => {
  const content = fileTurnContent("add this to the Savannah 2026 community", "Deck v2.pptx");
  assert.equal(content, `add this to the Savannah 2026 community\n\n${FILE_TURN_MARK}Deck v2.pptx`);
  assert.equal(fileTurnContent("", "a.pdf"), `Add this file\n\n${FILE_TURN_MARK}a.pdf`);
  assert.equal(isFileTurn(content), true);
  assert.equal(isLocalOnlyMessage(content), true);
  assert.equal(isFileTurn("EGFR inhibitors"), false);
  const history = [
    { role: "user", content },
    { role: "assistant", content: "Here's what I'd do." },
    { role: "user", content: "KRAS in pancreatic cancer" },
  ];
  assert.deepEqual(messagesForResearch(history), [{ role: "user", content: "KRAS in pancreatic cancer" }]);

  const route = readFileSync(new URL("../../../app/api/assistant/route.ts", import.meta.url), "utf8");
  assert.match(route, /isLocalOnlyMessage\(all\[all\.length - 1\]\.content\)/);
});

test("AssistantChat: a typed message with a file is handled before any backend call", () => {
  const src = readFileSync(new URL("../../../components/explore/AssistantChat.tsx", import.meta.url), "utf8");
  const fileAt = src.indexOf("if (withFile) {");
  const teamAt = src.indexOf("const teamIntent = detectTeamIntent(content);");
  const backendAt = src.indexOf('fetch("/api/assistant"');
  assert.ok(fileAt > 0 && fileAt < teamAt && teamAt < backendAt, "the file branch runs first");
  const branch = src.slice(fileAt, teamAt);
  assert.match(branch, /parseFilePlaceIntent\(content\)/);
  assert.match(branch, /extractFilePlace\(content\)/); // only the typed text
  assert.match(branch, /setFileCards\([\s\S]*?return;\s+\}/);
  assert.ok(!branch.includes("router.push"));
  assert.match(src, /const withFile = opts\.typed \? attached : null;/);
  // The extraction call sends the message and the mode, never the file.
  const cards = readFileSync(new URL("../../../components/explore/FileActionCards.tsx", import.meta.url), "utf8");
  assert.match(cards, /body: JSON\.stringify\(\{ message, mode: "file" \}\)/);
});

// ── the file itself ──────────────────────────────────────────────────────────

test("types and size come from each place's own rules", () => {
  assert.equal(attachProblem("notes.docx", "", 1024), null); // a project takes Word…
  assert.match(fileProblemFor("team", "notes.docx", "", 1024) ?? "", /PNG, JPEG, WebP, GIF, PDF or PPTX/); // …a team doesn't
  assert.equal(fileProblemFor("project", "notes.docx", "", 1024), null);
  assert.equal(fileProblemFor("community", "deck.pptx", "", 31 * 1024 * 1024), null);
  assert.match(attachProblem("big.pdf", "application/pdf", 51 * 1024 * 1024) ?? "", /over 50 MB/);
  assert.match(attachProblem("run.exe", "", 10) ?? "", /can't be shared/);
  assert.equal(defaultTitle("Lab meeting 2026-11-20.pptx"), "Lab meeting 2026-11-20");
});

// ── places and who may add a file ────────────────────────────────────────────

const row = (o: Partial<TargetRow> & Pick<TargetRow, "type" | "id" | "name" | "role">): TargetRow => ({
  slug: o.type === "project" ? null : o.id,
  memberCount: 4,
  code: null,
  ...o,
});

const ROWS: TargetRow[] = [
  row({ type: "community", id: "c1", name: "Savannah 2026", role: "admin" }),
  row({ type: "community", id: "c2", name: "Neuro-Oncology", role: "member" }),
  row({ type: "community", id: "c3", name: "CollaboFest 2026", role: "admin", inviteOnly: true }),
  row({ type: "team", id: "t1", name: "AI for DD", role: "member" }),
  row({ type: "team", id: "t2", name: "TEST team - delete me", role: "admin" }),
  row({ type: "project", id: "p1", name: "Glioma Atlas", role: "member", code: "C-103" }),
  row({ type: "project", id: "p2", name: "Kinase Screen", role: "lead" }),
];

test("canAddFileTo: community admins; any active team member; any project member", () => {
  assert.equal(canAddFileTo({ type: "community", role: "admin" }), true);
  assert.equal(canAddFileTo({ type: "community", role: "member" }), false);
  assert.equal(canAddFileTo({ type: "community", role: "lead" }), false);
  assert.equal(canAddFileTo({ type: "team", role: "member" }), true);
  assert.equal(canAddFileTo({ type: "team", role: "admin" }), true);
  assert.equal(canAddFileTo({ type: "project", role: "member" }), true);
  assert.equal(canAddFileTo({ type: "project", role: "manager" }), true);
});

test("matching for all three kinds of place", () => {
  const c = matchTargets(ROWS, "Savannah 2026", "community", canAddFileTo);
  assert.deepEqual(c.candidates.map((x) => x.href), ["/communities/c1"]);
  const t = matchTargets(ROWS, "AI for DD", "team", canAddFileTo);
  assert.deepEqual(t.candidates.map((x) => x.href), ["/teams/t1"]);
  const p = matchTargets(ROWS, "C-103", null, canAddFileTo);
  assert.deepEqual(p.candidates.map((x) => x.href), ["/projects/p1"]);
  // a community the person is only a member of is not offered
  const n = matchTargets(ROWS, "Neuro-Oncology", null, canAddFileTo);
  assert.equal(n.candidates.length, 0);
  assert.deepEqual(n.notAllowed, [{ type: "community", name: "Neuro-Oncology" }]);
});

test("no place named: every allowed place, communities then teams then projects", () => {
  const all = allowedPlaces(ROWS, canAddFileTo);
  assert.deepEqual(
    all.map((x) => `${x.type}:${x.id}`),
    ["community:c3", "community:c1", "team:t1", "team:t2", "project:p1", "project:p2"]
  );
  assert.equal(all.find((x) => x.id === "c3")?.inviteOnly, true);
});

test("several matches: all returned for a picker", () => {
  const rows = [...ROWS, row({ type: "team", id: "t9", name: "Glioma Atlas", role: "member" })];
  const m = matchTargets(rows, "Glioma Atlas", null, canAddFileTo);
  assert.deepEqual(m.candidates.map((x) => `${x.type}:${x.id}`), ["team:t9", "project:p1"]);
  assert.match(fileReplyFor({ kind: "candidates", count: 2, named: true }), /Pick one/);
  assert.match(fileReplyFor({ kind: "candidates", count: 6, named: false }), /Where should this file go/);
  assert.match(fileReplyFor({ kind: "candidates", count: 1, named: true }), /press Confirm/);
});

test("no match: a site admin is offered a community, anyone else a team", () => {
  assert.equal(matchTargets(ROWS, "Zebra Lab", null, canAddFileTo).candidates.length, 0);
  assert.equal(
    fileReplyFor({ kind: "none", name: "Zebra Lab", siteAdmin: true, type: null }),
    "No community called Zebra Lab. Create it and add this file?"
  );
  const other = fileReplyFor({ kind: "none", name: "Zebra Lab", siteAdmin: false, type: null });
  assert.match(other, /Create a team called Zebra Lab and add this file\?/);
  assert.ok(!other.includes("community called Zebra Lab. Create it"));
  // a site admin who asked for a team gets the team offer
  assert.match(fileReplyFor({ kind: "none", name: "Zebra Lab", siteAdmin: true, type: "team" }), /Create a team called Zebra Lab/);
  // none of these is the confirm line
  for (const s of [true, false]) assert.ok(!fileReplyFor({ kind: "none", name: "X", siteAdmin: s, type: null }).includes("press Confirm"));
});

// ── who can open it, and the result ──────────────────────────────────────────

test("access lines follow the real rules", () => {
  assert.match(accessLine({ type: "community" }), /^Only members of this community can open it, unless an admin pins it/);
  assert.match(accessLine({ type: "team" }), /^Only members of this team can open it\. Anyone with the team's link can join\./);
  assert.equal(accessLine({ type: "project" }), "Only members of this project can open it.");
});

test("result: QR for teams and open communities, a line for projects and invite-only communities", () => {
  assert.deepEqual(resultNote({ type: "team", inviteOnly: false, isOpen: true }), {
    kind: "qr",
    line: "People who scan this and sign in can join and see the file.",
  });
  assert.equal(resultNote({ type: "community", inviteOnly: false, isOpen: true }).kind, "qr");
  assert.match(resultNote({ type: "community", inviteOnly: false, isOpen: false }).line, /ask to join/);
  assert.deepEqual(resultNote({ type: "project", inviteOnly: false, isOpen: true }), { kind: "text", line: "Only project members can see it." });
  const colab = resultNote({ type: "community", inviteOnly: true, isOpen: false });
  assert.equal(colab.kind, "text");
  assert.match(colab.line, /invite only/);
});
