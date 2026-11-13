// Run with `npm test` (node --test). Replies on Progress updates and the team
// Tasks card (lib/server/teams/teamWorkRules.ts).

import test from "node:test";
import assert from "node:assert/strict";
import {
  REPLIES_SHOWN,
  canDeleteReply,
  groupReplies,
  isMissingTableError,
  orderTasks,
  parseAssignee,
  parseReplyText,
  parseTaskDue,
  parseTaskText,
  replyToggleLabel,
  cleanTeamUrl,
  createdShownKey,
  hasTeamOneTimeParams,
  learnSentKey,
  markOnceDone,
  onceDone,
  runOnceAfterMount,
  sendLearnOnce,
  shownReplies,
  taskDueLabel,
  teamDay,
  teamToday,
  type ReplyRow,
  type TaskRow,
} from "./teamWorkRules.ts";
import { todayIso } from "../projectWorkspace/status.ts";

const reply = (id: string, update: string, at: string, author = "u1"): ReplyRow => ({
  id,
  announcement_id: update,
  author_id: author,
  body: `reply ${id}`,
  created_at: at,
});

// ── replies ─────────────────────────────────────────────────────────────────

test("groupReplies: by update, each oldest first", () => {
  const g = groupReplies([
    reply("c", "u-a", "2026-11-03T10:00:00Z"),
    reply("a", "u-a", "2026-11-01T10:00:00Z"),
    reply("x", "u-b", "2026-11-02T10:00:00Z"),
    reply("b", "u-a", "2026-11-02T10:00:00Z"),
  ]);
  assert.deepEqual(Object.keys(g).sort(), ["u-a", "u-b"]);
  assert.deepEqual(g["u-a"].map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(g["u-b"].map((r) => r.id), ["x"]);
  assert.deepEqual(groupReplies([]), {});
});

test("groupReplies: same time sorts by id, so the order is stable", () => {
  const g = groupReplies([reply("z", "u", "2026-11-01T10:00:00Z"), reply("m", "u", "2026-11-01T10:00:00Z")]);
  assert.deepEqual(g.u.map((r) => r.id), ["m", "z"]);
});

test("shownReplies: up to three show in full; more collapse to the latest three", () => {
  assert.equal(REPLIES_SHOWN, 3);
  const three = ["a", "b", "c"];
  assert.deepEqual(shownReplies(three, false), { shown: three, showAllLabel: null });
  const five = ["a", "b", "c", "d", "e"];
  assert.deepEqual(shownReplies(five, false), { shown: ["c", "d", "e"], showAllLabel: "Show all 5 replies" });
  assert.deepEqual(shownReplies(five, true), { shown: five, showAllLabel: null });
  assert.deepEqual(shownReplies([], false), { shown: [], showAllLabel: null });
});

test("replyToggleLabel: 'Reply' with none, the count otherwise", () => {
  assert.equal(replyToggleLabel(0), "Reply");
  assert.equal(replyToggleLabel(1), "1 reply");
  assert.equal(replyToggleLabel(4), "4 replies");
});

test("parseReplyText: one line, not empty, at most 1000", () => {
  assert.deepEqual(parseReplyText("  nice\n work  "), { ok: true, text: "nice work" });
  assert.equal(parseReplyText("   ").ok, false);
  assert.equal(parseReplyText(42).ok, false);
  assert.equal(parseReplyText("x".repeat(1000)).ok, true);
  assert.equal(parseReplyText("x".repeat(1001)).ok, false);
});

test("canDeleteReply: the author or a lead", () => {
  assert.equal(canDeleteReply({ isLead: false, authorId: "a", viewerId: "a" }), true);
  assert.equal(canDeleteReply({ isLead: true, authorId: "a", viewerId: "b" }), true);
  assert.equal(canDeleteReply({ isLead: false, authorId: "a", viewerId: "b" }), false);
  assert.equal(canDeleteReply({ isLead: false, authorId: "", viewerId: "" }), false);
});

// ── tasks ───────────────────────────────────────────────────────────────────

const task = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id,
  text: `task ${id}`,
  done: false,
  assignee_id: null,
  due_date: null,
  position: 0,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

test("orderTasks: open first by due date, undated last; done apart", () => {
  const { open, done } = orderTasks([
    task("undated-new", { created_at: "2026-11-05T00:00:00Z" }),
    task("late", { due_date: "2026-11-20" }),
    task("done-1", { done: true, due_date: "2026-11-01" }),
    task("soon", { due_date: "2026-11-12" }),
    task("undated-old", { created_at: "2026-11-02T00:00:00Z" }),
    task("done-2", { done: true, created_at: "2026-11-03T00:00:00Z" }),
  ]);
  assert.deepEqual(open.map((t) => t.id), ["soon", "late", "undated-old", "undated-new"]);
  assert.deepEqual(done.map((t) => t.id), ["done-1", "done-2"]);
});

test("orderTasks: same due date keeps position, then oldest first", () => {
  const { open } = orderTasks([
    task("b", { due_date: "2026-11-12", position: 2 }),
    task("a", { due_date: "2026-11-12", position: 1 }),
    task("c", { due_date: "2026-11-12", position: 1, created_at: "2026-11-09T00:00:00Z" }),
  ]);
  assert.deepEqual(open.map((t) => t.id), ["a", "c", "b"]);
});

test("taskDueLabel: Today, Tomorrow, a date, the year when it differs, overdue for open tasks only", () => {
  const today = "2026-11-11";
  assert.deepEqual(taskDueLabel("2026-11-11", today), { text: "Today", overdue: false });
  assert.deepEqual(taskDueLabel("2026-11-12", today), { text: "Tomorrow", overdue: false });
  assert.deepEqual(taskDueLabel("2026-11-30", today), { text: "Nov 30", overdue: false });
  assert.deepEqual(taskDueLabel("2027-01-04", today), { text: "Jan 4, 2027", overdue: false });
  assert.deepEqual(taskDueLabel("2026-11-09", today), { text: "Overdue · Nov 9", overdue: true });
  assert.deepEqual(taskDueLabel("2026-11-09", today, true), { text: "Nov 9", overdue: false });
  assert.deepEqual(taskDueLabel("2026-12-31", "2026-12-30"), { text: "Tomorrow", overdue: false });
  assert.deepEqual(taskDueLabel("2027-01-01", "2026-12-31"), { text: "Tomorrow", overdue: false });
  assert.equal(taskDueLabel(null, today), null);
  assert.equal(taskDueLabel("2026-13-01", today), null);
  assert.equal(taskDueLabel("soon", today), null);
});

test("parseTaskText / parseTaskDue / parseAssignee", () => {
  assert.deepEqual(parseTaskText(" Book\nthe  room "), { ok: true, text: "Book the room" });
  assert.equal(parseTaskText("").ok, false);
  assert.equal(parseTaskText("x".repeat(301)).ok, false);
  assert.deepEqual(parseTaskDue(""), { ok: true, value: null });
  assert.deepEqual(parseTaskDue(null), { ok: true, value: null });
  assert.deepEqual(parseTaskDue("2026-11-30"), { ok: true, value: "2026-11-30" });
  assert.equal(parseTaskDue("2026-02-30").ok, false);
  assert.equal(parseTaskDue("11/30/2026").ok, false);
  assert.deepEqual(parseAssignee("", ["u1"]), { ok: true, value: null });
  assert.deepEqual(parseAssignee("u1", ["u1", "u2"]), { ok: true, value: "u1" });
  assert.equal(parseAssignee("stranger", ["u1"]).ok, false);
});

test("isMissingTableError: the table-not-there codes, nothing else", () => {
  assert.equal(isMissingTableError({ code: "42P01", message: 'relation "team_tasks" does not exist' }), true);
  assert.equal(isMissingTableError({ code: "PGRST205", message: "Could not find the table in the schema cache" }), true);
  assert.equal(isMissingTableError({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(isMissingTableError(null), false);
});

// ── dates in US Central ─────────────────────────────────────────────────────

// 6:30 PM CST on Nov 11 is already Nov 12 in UTC.
const EVENING_CENTRAL = new Date("2026-11-12T00:30:00Z");

test("teamToday: an evening in US Central is still that day (not UTC's tomorrow)", () => {
  assert.equal(EVENING_CENTRAL.toISOString().slice(0, 10), "2026-11-12"); // what UTC said
  assert.equal(teamToday(EVENING_CENTRAL), "2026-11-11");
  // Summer time too: 10 PM CDT on Jul 3.
  assert.equal(teamToday(new Date("2026-07-04T03:00:00Z")), "2026-07-03");
  // Just after Central midnight it is the next day.
  assert.equal(teamToday(new Date("2026-11-12T06:05:00Z")), "2026-11-12");
});

test("teamToday decides 'today' the same way the CollaboFest project home does", () => {
  for (const iso of ["2026-11-12T00:30:00Z", "2026-11-12T05:59:00Z", "2026-11-12T06:00:00Z", "2026-07-04T03:00:00Z"]) {
    assert.equal(teamToday(new Date(iso)), todayIso(new Date(iso)), iso);
  }
});

test("teamDay: an update posted at 6:30 PM Central on Nov 11 reads Nov 11", () => {
  assert.equal(teamDay("2026-11-12T00:30:00Z"), "Nov 11, 2026");
  assert.equal(teamDay("2026-11-12T06:30:00Z"), "Nov 12, 2026");
  assert.equal(teamDay("2027-01-01T03:00:00Z"), "Dec 31, 2026");
  assert.equal(teamDay(null), "");
  assert.equal(teamDay("nonsense"), "");
});

test("task labels on a Central evening: Today, Tomorrow and Overdue follow Central, not UTC", () => {
  const today = teamToday(EVENING_CENTRAL); // 2026-11-11
  assert.deepEqual(taskDueLabel("2026-11-11", today), { text: "Today", overdue: false });
  assert.deepEqual(taskDueLabel("2026-11-12", today), { text: "Tomorrow", overdue: false });
  assert.deepEqual(taskDueLabel("2026-11-10", today), { text: "Overdue · Nov 10", overdue: true });
});

// ── run once after mount (the ?learn=1 send) ────────────────────────────────

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    schedule: (cb: () => void) => {
      const id = next++;
      pending.set(id, cb);
      return id;
    },
    cancel: (id: unknown) => {
      pending.delete(id as number);
    },
    flush: () => {
      const cbs = [...pending.values()];
      pending.clear();
      cbs.forEach((cb) => cb());
    },
  };
}

test("runOnceAfterMount: Strict Mode's mount, cleanup, mount still runs it exactly once", () => {
  const t = fakeTimers();
  const ran = { current: false };
  let calls = 0;
  const fn = () => calls++;
  const cleanup1 = runOnceAfterMount(ran, fn, t.schedule, t.cancel); // mount
  cleanup1(); // Strict Mode cleanup
  runOnceAfterMount(ran, fn, t.schedule, t.cancel); // mount again
  t.flush();
  assert.equal(calls, 1);
  assert.equal(ran.current, true);
  // A later re-run of the effect (same page) does nothing.
  runOnceAfterMount(ran, fn, t.schedule, t.cancel);
  t.flush();
  assert.equal(calls, 1);
});

test("runOnceAfterMount: a cancelled run leaves it unmarked", () => {
  const t = fakeTimers();
  const ran = { current: false };
  let calls = 0;
  runOnceAfterMount(ran, () => calls++, t.schedule, t.cancel)();
  t.flush();
  assert.equal(calls, 0);
  assert.equal(ran.current, false);
});

// ── one-time params and the "already sent" guard ────────────────────────────

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const brokenStore = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

test("sendLearnOnce: sends once per team per session, even if learn=1 comes back", () => {
  const store = memoryStore();
  let sent = 0;
  assert.equal(sendLearnOnce(store, "kras-club-x1", () => sent++), true);
  // A reload of ?created=1&learn=1, or the effect running again: not sent again.
  assert.equal(sendLearnOnce(store, "kras-club-x1", () => sent++), false);
  assert.equal(sendLearnOnce(store, "kras-club-x1", () => sent++), false);
  assert.equal(sent, 1);
  assert.equal(store.m.get("team-learn-sent:kras-club-x1"), "1");
  // Another team is its own request.
  assert.equal(sendLearnOnce(store, "lung-lab-y2", () => sent++), true);
  assert.equal(sent, 2);
});

test("sendLearnOnce: storage that is missing or throws never blocks the first send", () => {
  let sent = 0;
  assert.equal(sendLearnOnce(null, "t", () => sent++), true);
  assert.equal(sendLearnOnce(brokenStore, "t", () => sent++), true);
  assert.equal(sent, 2);
});

test("onceDone / markOnceDone and the keys", () => {
  const store = memoryStore();
  assert.equal(learnSentKey("abc"), "team-learn-sent:abc");
  assert.equal(createdShownKey("abc"), "team-created-shown:abc");
  assert.equal(onceDone(store, createdShownKey("abc")), false);
  markOnceDone(store, createdShownKey("abc"));
  assert.equal(onceDone(store, createdShownKey("abc")), true);
  assert.equal(onceDone(store, learnSentKey("abc")), false);
  assert.doesNotThrow(() => markOnceDone(brokenStore, "k"));
  assert.equal(onceDone(brokenStore, "k"), false);
  assert.equal(onceDone(undefined, "k"), false);
});

test("cleanTeamUrl: drops created, skipped and learn; keeps the rest and the hash", () => {
  assert.equal(cleanTeamUrl("/teams/kras-x1", "?created=1&learn=1"), "/teams/kras-x1");
  assert.equal(cleanTeamUrl("/teams/kras-x1", "?created=1&skipped=2&learn=1"), "/teams/kras-x1");
  assert.equal(cleanTeamUrl("/teams/kras-x1", "?created=1&settings=1", "#people"), "/teams/kras-x1?settings=1#people");
  assert.equal(cleanTeamUrl("/teams/kras-x1", ""), "/teams/kras-x1");
  assert.equal(hasTeamOneTimeParams("?created=1"), true);
  assert.equal(hasTeamOneTimeParams("?learn=1"), true);
  assert.equal(hasTeamOneTimeParams("?settings=1"), false);
  assert.equal(hasTeamOneTimeParams(""), false);
});
