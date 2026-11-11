// Run with `npm test`. The Progress and Handover cards on a team page: the pure
// rules in teamRules.ts, the migration they rely on, and where the page puts them.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PROGRESS_TAG,
  HANDOVER_NOTE_HINT,
  HANDOVER_NOTE_MAX,
  HANDOVER_SLOTS,
  PROGRESS_SHOWN,
  PROGRESS_TAGS,
  PROGRESS_TAG_LABEL,
  PROGRESS_TEXT_MAX,
  canChangeHandover,
  canDeleteProgress,
  isHandoverSlot,
  isProgressTag,
  parseHandoverLink,
  parseHandoverNote,
  parseHandoverValue,
  parseProgressText,
  shownProgress,
  splitAnnouncements,
  splitResources,
} from "./teamRules.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const sql = () => readFileSync(new URL("../../../../database/migrations/2026-11-11_team_progress_handover.sql", import.meta.url), "utf8");

// ── progress ────────────────────────────────────────────────────────────────

test("progress tags: Done, Working on, Stuck; Working on is the default", () => {
  assert.deepEqual([...PROGRESS_TAGS], ["done", "working", "stuck"]);
  assert.deepEqual(PROGRESS_TAGS.map((t) => PROGRESS_TAG_LABEL[t]), ["Done", "Working on", "Stuck"]);
  assert.equal(DEFAULT_PROGRESS_TAG, "working");
  for (const ok of PROGRESS_TAGS) assert.equal(isProgressTag(ok), true);
  for (const bad of ["Done", "blocked", "", null, undefined, 1]) assert.equal(isProgressTag(bad), false, String(bad));
});

test("progress text: one line, not empty, at most 280 letters", () => {
  assert.deepEqual(parseProgressText("  Docked  the\n first 200\tcompounds "), { ok: true, text: "Docked the first 200 compounds" });
  for (const empty of ["", "   ", "\n", null, undefined, 5]) assert.equal(parseProgressText(empty).ok, false, String(empty));
  assert.equal(parseProgressText("x".repeat(PROGRESS_TEXT_MAX)).ok, true);
  assert.equal(parseProgressText("x".repeat(PROGRESS_TEXT_MAX + 1)).ok, false);
});

test("splitAnnouncements: tagged rows are Progress, the rest Team news, order kept", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const { news, progress } = splitAnnouncements(items, { a: "stuck", c: "done", d: "nonsense" });
  assert.deepEqual(news.map((n) => n.id), ["b", "d"]);
  assert.deepEqual(progress.map((p) => [p.id, p.tag]), [["a", "stuck"], ["c", "done"]]);
  // No tags at all (the migration is not applied yet): everything is news, as before.
  assert.deepEqual(splitAnnouncements(items, {}), { news: items, progress: [] });
});

test("shownProgress: the latest five, and the rest behind See older updates", () => {
  const seven = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(PROGRESS_SHOWN, 5);
  assert.deepEqual(shownProgress(seven, false), { shown: [1, 2, 3, 4, 5], older: 2 });
  assert.deepEqual(shownProgress(seven, true), { shown: seven, older: 0 });
  assert.deepEqual(shownProgress([1, 2, 3, 4, 5], false), { shown: [1, 2, 3, 4, 5], older: 0 });
  assert.deepEqual(shownProgress([], false), { shown: [], older: 0 });
});

test("a progress update is deleted by its author or a lead, nobody else", () => {
  assert.equal(canDeleteProgress({ isLead: false, authorId: "u1", viewerId: "u1" }), true);
  assert.equal(canDeleteProgress({ isLead: true, authorId: "u1", viewerId: "u2" }), true);
  assert.equal(canDeleteProgress({ isLead: false, authorId: "u1", viewerId: "u2" }), false);
  assert.equal(canDeleteProgress({ isLead: false, authorId: "", viewerId: "" }), false);
});

// ── handover ────────────────────────────────────────────────────────────────

test("handover: four fixed rows in order, three links and a note", () => {
  assert.deepEqual(HANDOVER_SLOTS.map((s) => [s.key, s.label, s.kind]), [
    ["box", "Box folder", "link"],
    ["github", "GitHub repository", "link"],
    ["report", "Final report", "link"],
    ["note", "Handover note", "note"],
  ]);
  for (const s of HANDOVER_SLOTS) assert.equal(isHandoverSlot(s.key), true);
  for (const bad of ["drive", "", null, undefined]) assert.equal(isHandoverSlot(bad), false, String(bad));
  assert.equal(HANDOVER_NOTE_HINT, "What is done, what is left, who to ask");
});

test("a handover link must be http or https", () => {
  assert.deepEqual(parseHandoverLink("  https://uab.box.com/s/abc "), { ok: true, url: "https://uab.box.com/s/abc" });
  assert.equal(parseHandoverLink("http://github.com/aimed-lab/x").ok, true);
  for (const bad of ["", "   ", "javascript:alert(1)", "ftp://x.org/f", "box.com/s/abc", "data:text/html,x", null, 7]) {
    assert.equal(parseHandoverLink(bad).ok, false, String(bad));
  }
});

test("the handover note is plain text, not empty, at most 1000 characters", () => {
  assert.deepEqual(parseHandoverNote("  Done: docking.\r\nLeft: assays. "), { ok: true, note: "Done: docking.\nLeft: assays." });
  assert.equal(parseHandoverNote("   ").ok, false);
  assert.equal(parseHandoverNote("x".repeat(HANDOVER_NOTE_MAX)).ok, true);
  assert.equal(parseHandoverNote("x".repeat(HANDOVER_NOTE_MAX + 1)).ok, false);
});

test("parseHandoverValue: a link goes in url, the note in description", () => {
  assert.deepEqual(parseHandoverValue("box", "https://uab.box.com/s/abc"), { ok: true, url: "https://uab.box.com/s/abc", description: "" });
  assert.deepEqual(parseHandoverValue("note", "Ask Ada."), { ok: true, url: null, description: "Ask Ada." });
  assert.equal(parseHandoverValue("github", "not a link").ok, false);
  // A note may contain a link as text; a link row may not hold free text.
  assert.equal(parseHandoverValue("note", "see https://x.org").ok, true);
});

test("splitResources: always four handover rows, slotted rows are not Shared documents", () => {
  const res = [
    { id: "r1", url: "https://x.org/paper", description: "" },
    { id: "r2", url: "https://uab.box.com/s/abc", description: "" },
    { id: "r3", url: null, description: "Done: docking." },
    { id: "r4", url: null, description: "" },
  ];
  const { handover, documents } = splitResources(res, { r2: "box", r3: "note", r4: "report" });
  assert.deepEqual(handover.map((h) => [h.slot, h.resource?.id ?? null]), [
    ["box", "r2"],
    ["github", null],
    ["report", null], // slotted but holds no link: shown as empty
    ["note", "r3"],
  ]);
  assert.deepEqual(documents.map((d) => d.id), ["r1"]);

  // Nothing slotted (or the migration is not applied yet): four empty rows, every document kept.
  const none = splitResources(res, {});
  assert.deepEqual(none.handover.map((h) => h.resource), [null, null, null, null]);
  assert.equal(none.documents.length, 4);
  assert.deepEqual(splitResources([], {}).handover.map((h) => h.label), ["Box folder", "GitHub repository", "Final report", "Handover note"]);
});

test("a handover row: anyone fills an empty one; whoever added it, or a lead, changes it", () => {
  assert.equal(canChangeHandover({ isLead: false, addedBy: null, viewerId: "u2" }), true);
  assert.equal(canChangeHandover({ isLead: false, addedBy: "u1", viewerId: "u1" }), true);
  assert.equal(canChangeHandover({ isLead: true, addedBy: "u1", viewerId: "u2" }), true);
  assert.equal(canChangeHandover({ isLead: false, addedBy: "u1", viewerId: "u2" }), false);
});

// ── the migration and the page ──────────────────────────────────────────────

test("migration: one transaction, idempotent, the tag and slot values match the code", () => {
  const m = sql();
  const body = m.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(body.trim(), /^BEGIN;[\s\S]*COMMIT;$/);
  assert.match(body, /ADD COLUMN IF NOT EXISTS progress_tag TEXT/);
  assert.match(body, /ADD COLUMN IF NOT EXISTS handover_slot TEXT/);
  assert.ok(body.includes(`IN (${PROGRESS_TAGS.map((t) => `'${t}'`).join(", ")})`));
  assert.ok(body.includes(`IN (${HANDOVER_SLOTS.map((s) => `'${s.key}'`).join(", ")})`));
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS uq_community_resources_handover_slot/);
  // every CREATE POLICY is preceded by a DROP of the same name
  const created = [...body.matchAll(/CREATE POLICY "([^"]+)"/g)].map((x) => x[1]);
  assert.equal(created.length, 3);
  for (const name of created) assert.ok(body.includes(`DROP POLICY IF EXISTS "${name}"`), name);
  assert.doesNotMatch(body, /DELETE FROM|DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("migration: a member writes only TAGGED rows, in a team they are an active member of", () => {
  const body = sql().split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  const policy = (name: string) => {
    const start = body.indexOf(`CREATE POLICY "${name}"`);
    assert.ok(start > 0, name);
    return body.slice(start, body.indexOf(";", start));
  };
  const insert = policy("Community announcements: admin or team progress insert");
  assert.match(insert, /auth\.uid\(\) = author_id/);
  assert.match(insert, /progress_tag IS NOT NULL\s+AND public\.is_team\(community_id\)\s+AND public\.is_community_member\(community_id, auth\.uid\(\)\)/);

  const update = policy("Community announcements: admin or progress author update");
  const check = update.slice(update.indexOf("WITH CHECK"));
  assert.match(check, /progress_tag IS NOT NULL/);
  assert.match(check, /author_id = auth\.uid\(\)/);
  assert.match(check, /public\.is_community_member\(community_id, auth\.uid\(\)\)/);

  const del = policy("Community announcements: admin or progress author delete");
  assert.match(del, /progress_tag IS NOT NULL\s+AND public\.is_team\(community_id\)\s+AND author_id = auth\.uid\(\)/);
  // The admin branch of all three is kept, so communities behave as before.
  for (const p of [insert, update, del]) assert.match(p, /public\.is_community_admin\(community_id, auth\.uid\(\)\)/);
});

test("team page: the two cards are for members only, above the tiles, and the lists are split", () => {
  const page = read("app/teams/[slug]/page.tsx");
  const gate = page.indexOf('membership.state !== "active"');
  const cards = page.indexOf("<ProgressCard");
  assert.ok(gate > 0 && cards > gate, "the join card returns before the cards");
  assert.ok(cards < page.indexOf("<HandoverCard") && page.indexOf("<HandoverCard") < page.indexOf("<TeamTiles"));
  assert.ok(page.indexOf("<TeamHeader") < cards);
  assert.match(page, /splitAnnouncements\(allAnnouncements, progressTags\)/);
  assert.match(page, /splitResources\(allResources, handoverSlots\)/);
  assert.match(page, /lg:grid-cols-2/);
});

test("server: progress and handover are for teams only, and never touch untagged news", () => {
  const teams = read("lib/server/teams/teams.ts");
  assert.match(teams, /getCommunityKind\(teamId\)\) !== "team"/);
  const del = teams.slice(teams.indexOf("export async function deleteProgressUpdate"), teams.indexOf("export async function setHandoverSlot"));
  assert.match(del, /\.not\("progress_tag", "is", null\)/);
  // The community code is not changed by this feature.
  const communities = read("lib/server/communities.ts");
  assert.doesNotMatch(communities, /progress_tag|handover_slot/);
});
