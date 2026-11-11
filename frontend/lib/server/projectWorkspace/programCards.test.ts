// Run with `npm test`. The ColaboFest project cards (/programs/colabofest-2026) and the
// order of the cards there and on /projects.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FINALIST_DUE, FINALIST_TASKS } from "../../colabofestConfig.ts";
import {
  STALE_ANNOUNCEMENT_LABEL,
  announcementIsStale,
  announcementStatus,
  buildProgramCardView,
  finalistProgress,
  lastAnnouncementAt,
  programCountLine,
  projectCode,
  projectTasks,
  sortMyProjects,
  sortProgramCards,
  taskRows,
  taskStatus,
  type ProgramItem,
} from "./programCards.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const NOW = new Date("2026-11-11T18:00:00Z");
const TODAY = "2026-11-11";

const finalistItem = (n: number, status: string): ProgramItem => ({ label: FINALIST_TASKS[n].label, status, list_key: "team", due_date: "2026-11-11" });
const item = (label: string, status: string, list_key: string | null, due_date: string | null = null): ProgramItem => ({ label, status, list_key, due_date });

// ── code and order ───────────────────────────────────────────────────────────

test("projectCode: the C-### part of the description line", () => {
  assert.equal(projectCode("ColaboFest 2026 · C-108"), "C-108");
  assert.equal(projectCode("ColaboFest 2026 · C-101\nmore text"), "C-101");
  for (const none of ["ColaboFest 2026", "ABC-12x", "", null, undefined]) assert.equal(projectCode(none), null, String(none));
});

test("order on the program page: finalists first, then the rest, each group by code", () => {
  const cards = [
    { name: "h", finalist: false, code: "C-108" },
    { name: "a", finalist: true, code: "C-107" },
    { name: "c", finalist: false, code: "C-101" },
    { name: "z", finalist: false, code: null },
    { name: "b", finalist: true, code: "C-103" },
    { name: "y", finalist: false, code: null },
    { name: "d", finalist: false, code: "C-1000" },
  ];
  assert.deepEqual(sortProgramCards(cards).map((c) => c.code ?? c.name), ["C-103", "C-107", "C-101", "C-108", "C-1000", "y", "z"]);
  assert.equal(cards[0].name, "h", "the input is not reordered");
});

test("order on /projects: ColaboFest finalists, other ColaboFest by code, then the rest as they came", () => {
  const p = (name: string, inProgram: boolean, finalist: boolean, code: string | null) => ({ name, inProgram, finalist, code });
  const sorted = sortMyProjects([
    p("newest other", false, false, null),
    p("cf 108", true, false, "C-108"),
    p("older other", false, false, null),
    p("cf 107 finalist", true, true, "C-107"),
    p("cf 102", true, false, "C-102"),
    p("cf 104 finalist", true, true, "C-104"),
    // "finalist" set on a project outside the program does not move it up.
    p("oldest other", false, true, "C-999"),
  ]);
  assert.deepEqual(sorted.map((x) => x.name), ["cf 104 finalist", "cf 107 finalist", "cf 102", "cf 108", "newest other", "older other", "oldest other"]);
});

test("the count line under the intro", () => {
  assert.equal(programCountLine(8, 3), "8 projects · 3 finalists");
  assert.equal(programCountLine(1, 1), "1 project · 1 finalist");
  assert.equal(programCountLine(2, 0), "2 projects · 0 finalists");
});

// ── task rows ────────────────────────────────────────────────────────────────

test("finalist tasks: the same three, counted by label; a task with no item yet is not done", () => {
  assert.deepEqual(finalistProgress([]), { done: 0, total: 3 });
  assert.deepEqual(finalistProgress([finalistItem(0, "ready"), finalistItem(1, "not_yet")]), { done: 1, total: 3 });
  assert.deepEqual(finalistProgress([0, 1, 2].map((n) => finalistItem(n, "ready"))), { done: 3, total: 3 });
  // The same label in another list is not a finalist task.
  assert.deepEqual(finalistProgress([{ ...finalistItem(0, "ready"), list_key: "sparc" }]), { done: 0, total: 3 });
});

test("task rows: only lists with items; a finalist's team list is 'Finalist tasks'", () => {
  assert.deepEqual(taskRows([], false), []);
  assert.deepEqual(taskRows([], true), [{ key: "finalist", label: "Finalist tasks", done: 0, total: 3 }]);
  assert.deepEqual(
    taskRows([finalistItem(0, "ready"), item("Order compound", "not_yet", "sparc"), item("QC", "ready", "sparc")], true),
    [
      { key: "finalist", label: "Finalist tasks", done: 1, total: 3 },
      { key: "sparc", label: "UAB SPARC checklist", done: 1, total: 2 },
    ]
  );
  // Not a finalist: plain lists, empty ones left out.
  assert.deepEqual(taskRows([item("a", "ready", null), item("b", "not_yet", "team"), item("c", "not_yet", "southern_research")], false), [
    { key: "team", label: "Team tasks", done: 1, total: 2 },
    { key: "southern_research", label: "Southern Research checklist", done: 0, total: 1 },
  ]);
  // A finalist's other team items are their own row, not counted as finalist tasks.
  assert.deepEqual(taskRows([finalistItem(0, "ready"), item("Extra", "not_yet", "team")], true), [
    { key: "finalist", label: "Finalist tasks", done: 1, total: 3 },
    { key: "team", label: "Team tasks", done: 0, total: 1 },
  ]);
});

// ── the status line (rule 4): every case ─────────────────────────────────────

test("status: no tasks -> nothing", () => {
  assert.equal(taskStatus([], TODAY, NOW), null);
});

test("status: all tasks done -> 'All tasks done'", () => {
  assert.deepEqual(taskStatus([{ done: true, due: "2026-11-01" }, { done: true, due: null }], TODAY, NOW), { tone: "done", text: "All tasks done" });
});

test("status: tasks unfinished and due date passed -> 'Overdue since Nov 11'", () => {
  assert.deepEqual(taskStatus([{ done: false, due: "2026-11-11" }], "2026-11-12", NOW), { tone: "overdue", text: "Overdue since Nov 11" });
  // The earliest unfinished due day is the one stated; a done task's date does not count.
  assert.deepEqual(
    taskStatus([{ done: true, due: "2026-10-01" }, { done: false, due: "2026-11-09" }, { done: false, due: "2026-12-15" }], TODAY, NOW),
    { tone: "overdue", text: "Overdue since Nov 9" }
  );
});

test("status: tasks unfinished and due today -> 'Due today'", () => {
  assert.deepEqual(taskStatus([{ done: false, due: "2026-11-11" }, { done: true, due: "2026-11-01" }], TODAY, NOW), { tone: "today", text: "Due today" });
});

test("status: tasks unfinished and due later -> 'Due Nov 11'", () => {
  assert.deepEqual(taskStatus([{ done: false, due: "2026-11-11" }], "2026-11-10", NOW), { tone: "later", text: "Due Nov 11" });
  assert.deepEqual(taskStatus([{ done: false, due: "2027-04-01" }], TODAY, NOW), { tone: "later", text: "Due Apr 1, 2027" });
});

test("status: unfinished tasks with no due date at all -> nothing (no date to state)", () => {
  assert.equal(taskStatus([{ done: false, due: null }, { done: true, due: "2026-11-01" }], TODAY, NOW), null);
});

test("a finalist's three tasks are due on the finalist due date, like the project home", () => {
  const tasks = projectTasks([finalistItem(0, "ready")], true);
  assert.deepEqual(tasks, [
    { done: true, due: FINALIST_DUE.from },
    { done: false, due: FINALIST_DUE.from },
    { done: false, due: FINALIST_DUE.from },
  ]);
  assert.equal(taskStatus(tasks, "2026-11-10", NOW)?.text, `Due ${FINALIST_DUE.shown}`);
  assert.equal(taskStatus(tasks, FINALIST_DUE.from, NOW)?.text, "Due today");
  assert.equal(taskStatus(tasks, "2026-11-12", NOW)?.text, `Overdue since ${FINALIST_DUE.shown}`);
  // Not a finalist: each item has its own due date, or none.
  assert.deepEqual(projectTasks([item("a", "not_yet", "team", "2026-12-01"), item("b", "ready", "sparc")], false), [
    { done: false, due: "2026-12-01" },
    { done: true, due: null },
  ]);
});

test("announcements: 'Last announcement Nov 9' or 'No announcements yet'; help posts and updates do not count", () => {
  const updates = [
    { kind: "announcement", created_at: "2026-11-02T10:00:00Z" },
    { kind: "announcement", created_at: "2026-11-09T10:00:00Z" },
    { kind: "help", created_at: "2026-11-10T10:00:00Z" },
    { kind: "update", created_at: "2026-11-11T10:00:00Z" },
  ];
  assert.equal(lastAnnouncementAt(updates), "2026-11-09T10:00:00Z");
  assert.equal(announcementStatus("2026-11-09T10:00:00Z", NOW), "Last announcement Nov 9");
  assert.equal(lastAnnouncementAt(updates.filter((u) => u.kind !== "announcement")), null);
  assert.equal(announcementStatus(null, NOW), "No announcements yet");
});

test("warning badge: only when an announcement exists and the last one is more than 14 days old", () => {
  assert.equal(STALE_ANNOUNCEMENT_LABEL, "No announcement in 14+ days");
  assert.equal(announcementIsStale(null, NOW), false, "never had an announcement: no badge");
  assert.equal(announcementIsStale("2026-11-09T10:00:00Z", NOW), false);
  assert.equal(announcementIsStale("2026-10-28T18:00:00Z", NOW), false, "exactly 14 days");
  assert.equal(announcementIsStale("2026-10-27T10:00:00Z", NOW), true);
});

test("a whole card", () => {
  const card = buildProgramCardView({
    id: "p1",
    name: "CD38 Fibrosis",
    description: "ColaboFest 2026 · C-107",
    finalist: true,
    teamSize: 6,
    items: [finalistItem(0, "ready")],
    updates: [
      { kind: "announcement", created_at: "2026-10-20T10:00:00Z", resolved_at: null },
      { kind: "help", created_at: "2026-11-01T10:00:00Z", resolved_at: null },
    ],
    today: TODAY,
    now: NOW,
  });
  assert.deepEqual(card, {
    id: "p1",
    name: "CD38 Fibrosis",
    code: "C-107",
    finalist: true,
    teamSize: 6,
    needsHelp: true,
    staleAnnouncement: true,
    rows: [{ key: "finalist", label: "Finalist tasks", done: 1, total: 3 }],
    tasks: { tone: "today", text: "Due today" },
    announcements: "Last announcement Oct 20",
  });

  const bare = buildProgramCardView({ id: "p2", name: "x", description: null, finalist: false, teamSize: 1, items: [], updates: [], today: TODAY, now: NOW });
  assert.deepEqual([bare.code, bare.needsHelp, bare.staleAnnouncement, bare.rows, bare.tasks, bare.announcements], [null, false, false, [], null, "No announcements yet"]);
});

// ── the two pages ────────────────────────────────────────────────────────────

test("the program page: new wording, same links, and never 'winner'", () => {
  const page = read("app/programs/colabofest-2026/page.tsx");
  assert.match(page, /How each ColaboFest project is doing: tasks, due dates and the latest announcements, in one place\./);
  assert.match(page, /programCountLine\(result\.cards\.length, finalists\)/);
  assert.match(page, /href=\{tabHref\(c\.id, "overview"\)\}[^>]*>\s*Open project/);
  assert.match(page, /href=\{tabHref\(c\.id, "announcements"\)\}[^>]*>\s*Announcements/);
  assert.match(page, /No tasks yet/);
  assert.match(page, /line-clamp-4/);
  assert.match(page, /md:grid-cols-2 lg:grid-cols-3/);
  for (const gone of ["Nothing overdue", "No updates yet", "No update in 14+ days", "PILL_LABEL"]) assert.ok(!page.includes(gone), gone);
  for (const f of ["app/programs/colabofest-2026/page.tsx", "lib/server/projectWorkspace/programCards.ts", "components/projects/ProjectCard.tsx", "app/projects/page.tsx"]) {
    assert.doesNotMatch(read(f), /winner/i, f);
  }
  // The data comes from the queries the page already ran, with more columns.
  const program = read("lib/server/projectWorkspace/program.ts");
  assert.match(program, /\.select\("id, name, description, finalist"\)/);
  assert.match(program, /\.select\("project_id, label, status, list_key, due_date"\)/);
  assert.equal(program.split(".from(").length - 1, 6, "no new query");
});

test("/projects: the order, one ColaboFest line with the Finalist badge, a three-line title, no divider", () => {
  assert.match(read("app/projects/page.tsx"), /sortMyProjects\(/);
  const card = read("components/projects/ProjectCard.tsx");
  assert.match(card, /title=\{project\.name\}/);
  assert.match(card, /line-clamp-3/);
  assert.match(card, /★ Finalist/);
  assert.ok(!card.includes("border-t"), "no divider");
  assert.ok(!card.includes('? "ColaboFest 2026"'), "no separate ColaboFest 2026 tag");
  assert.match(read("lib/server/projects.ts"), /challenge_key, program, finalist, created_at/);
});
