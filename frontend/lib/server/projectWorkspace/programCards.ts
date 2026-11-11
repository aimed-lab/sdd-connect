// lib/server/projectWorkspace/programCards.ts: the pure rules behind the ColaboFest
// project cards on /programs/colabofest-2026 and the order of the cards there and on
// /projects: the project code, finalists first, which task rows a card shows, the one
// status line and the warning badge. No next/* imports, so `npm test` covers it.
//
// The finalist task count and due date are the ones the project home uses
// (cfHome.ts): the three FINALIST_TASKS found by label, due FINALIST_DUE.

import { FINALIST_DUE, FINALIST_TASKS } from "../../colabofestConfig.ts";
import { formatDay } from "../pages/pageViewHelpers.ts";

// ── code and order ───────────────────────────────────────────────────────────

/** The project code ("C-108") from the description line ("ColaboFest 2026 · C-108"), or null. */
export function projectCode(description: string | null | undefined): string | null {
  return (description ?? "").match(/\bC-\d+\b/)?.[0] ?? null;
}

function codeNumber(code: string | null): number {
  return code ? Number(code.slice(2)) : Number.POSITIVE_INFINITY;
}

/** Finalists first, then the rest; each group by code (C-101, C-102, ...). A project
 *  with no code comes after the ones that have one, by name. */
export function sortProgramCards<T extends { finalist: boolean; code: string | null; name: string }>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      Number(b.finalist) - Number(a.finalist) ||
      codeNumber(a.code) - codeNumber(b.code) ||
      a.name.localeCompare(b.name)
  );
}

/** /projects: ColaboFest finalists first, then the other ColaboFest projects by code,
 *  then every other project in the order it came in. */
export function sortMyProjects<T extends { inProgram: boolean; finalist: boolean; code: string | null; name: string }>(projects: T[]): T[] {
  const program = sortProgramCards(projects.filter((p) => p.inProgram).map((p) => ({ ...p, finalist: p.finalist })));
  return [...program, ...projects.filter((p) => !p.inProgram)];
}

/** "8 projects · 3 finalists". */
export function programCountLine(total: number, finalists: number): string {
  return `${total} ${total === 1 ? "project" : "projects"} · ${finalists} ${finalists === 1 ? "finalist" : "finalists"}`;
}

// ── tasks ────────────────────────────────────────────────────────────────────

export type ProgramItem = { label: string; status: string; list_key?: string | null; due_date?: string | null };
export type TaskRow = { key: string; label: string; done: number; total: number };

const FINALIST_LABELS: readonly string[] = FINALIST_TASKS.map((t) => t.label);
const listOf = (i: ProgramItem) => (i.list_key === "sparc" || i.list_key === "southern_research" ? i.list_key : "team");
const isFinalistItem = (i: ProgramItem) => listOf(i) === "team" && FINALIST_LABELS.includes(i.label);

/** The three finalist tasks: done when the checklist item with that label is ready (a
 *  task whose item does not exist yet is not done). Same count as the project home. */
export function finalistProgress(items: ProgramItem[]): { done: number; total: number } {
  const done = FINALIST_TASKS.filter((t) => items.some((i) => isFinalistItem(i) && i.label === t.label && i.status === "ready")).length;
  return { done, total: FINALIST_TASKS.length };
}

/** The task rows of a card: only lists with at least one item. A finalist's three
 *  tasks are their own row, "Finalist tasks". */
export function taskRows(items: ProgramItem[], finalist: boolean): TaskRow[] {
  const rows: TaskRow[] = [];
  if (finalist) rows.push({ key: "finalist", label: "Finalist tasks", ...finalistProgress(items) });
  const rest = finalist ? items.filter((i) => !isFinalistItem(i)) : items;
  const lists: [string, string][] = [
    ["team", "Team tasks"],
    ["sparc", "UAB SPARC checklist"],
    ["southern_research", "Southern Research checklist"],
  ];
  for (const [key, label] of lists) {
    const mine = rest.filter((i) => listOf(i) === key);
    if (mine.length > 0) rows.push({ key, label, done: mine.filter((i) => i.status === "ready").length, total: mine.length });
  }
  return rows;
}

/** Every task of a project as done / not done with its due day. A finalist's three
 *  tasks are due FINALIST_DUE; any other item has its own due date, or none. */
export function projectTasks(items: ProgramItem[], finalist: boolean): { done: boolean; due: string | null }[] {
  const out: { done: boolean; due: string | null }[] = [];
  if (finalist) {
    for (const t of FINALIST_TASKS) {
      out.push({ done: items.some((i) => isFinalistItem(i) && i.label === t.label && i.status === "ready"), due: FINALIST_DUE.from });
    }
  }
  for (const i of finalist ? items.filter((x) => !isFinalistItem(x)) : items) {
    out.push({ done: i.status === "ready", due: i.due_date ?? null });
  }
  return out;
}

// ── the status line ──────────────────────────────────────────────────────────

export type TaskStatus = { tone: "overdue" | "today" | "later" | "done"; text: string };

/** The tasks part of the status line. `today` is a YYYY-MM-DD day.
 *    no tasks                              -> null
 *    all tasks done                        -> "All tasks done"
 *    unfinished, earliest due day passed   -> "Overdue since Nov 11"
 *    unfinished, earliest due day is today -> "Due today"
 *    unfinished, earliest due day is later -> "Due Nov 11"
 *  The due day is the earliest one among the UNFINISHED tasks. Unfinished tasks that
 *  have no due date at all give null: there is no date to state. */
export function taskStatus(tasks: { done: boolean; due: string | null }[], today: string, now: Date = new Date()): TaskStatus | null {
  if (tasks.length === 0) return null;
  const open = tasks.filter((t) => !t.done);
  if (open.length === 0) return { tone: "done", text: "All tasks done" };
  const due = open.map((t) => t.due).filter((d): d is string => !!d).sort()[0];
  if (!due) return null;
  const shown = formatDay(due, now) ?? due;
  if (due < today) return { tone: "overdue", text: `Overdue since ${shown}` };
  if (due === today) return { tone: "today", text: "Due today" };
  return { tone: "later", text: `Due ${shown}` };
}

/** The newest announcement's timestamp, or null when there has never been one. */
export function lastAnnouncementAt(updates: { kind: string; created_at: string }[]): string | null {
  return updates.reduce<string | null>(
    (m, u) => (u.kind === "announcement" && (m === null || u.created_at > m) ? u.created_at : m),
    null
  );
}

/** "Last announcement Nov 9", or "No announcements yet". */
export function announcementStatus(last: string | null, now: Date = new Date()): string {
  const day = last ? formatDay(last, now) : null;
  return day ? `Last announcement ${day}` : "No announcements yet";
}

export const STALE_ANNOUNCEMENT_DAYS = 14;
export const STALE_ANNOUNCEMENT_LABEL = "No announcement in 14+ days";

/** The warning badge: only when there HAS been an announcement and the last one is
 *  more than 14 days old. A project that never had one gets no badge. */
export function announcementIsStale(last: string | null, now: Date = new Date()): boolean {
  if (!last) return false;
  const t = new Date(last).getTime();
  return !Number.isNaN(t) && now.getTime() - t > STALE_ANNOUNCEMENT_DAYS * 24 * 60 * 60 * 1000;
}

// ── the card ─────────────────────────────────────────────────────────────────

export type ProgramCardView = {
  id: string;
  name: string;
  code: string | null;
  finalist: boolean;
  teamSize: number;
  needsHelp: boolean;
  staleAnnouncement: boolean;
  rows: TaskRow[];
  tasks: TaskStatus | null;
  announcements: string;
};

export function buildProgramCardView(i: {
  id: string;
  name: string;
  description: string | null;
  finalist: boolean;
  teamSize: number;
  items: ProgramItem[];
  updates: { kind: string; created_at: string; resolved_at: string | null }[];
  today: string;
  now?: Date;
}): ProgramCardView {
  const now = i.now ?? new Date();
  const last = lastAnnouncementAt(i.updates);
  return {
    id: i.id,
    name: i.name,
    code: projectCode(i.description),
    finalist: i.finalist,
    teamSize: i.teamSize,
    needsHelp: i.updates.some((u) => u.kind === "help" && !u.resolved_at),
    staleAnnouncement: announcementIsStale(last, now),
    rows: taskRows(i.items, i.finalist),
    tasks: taskStatus(projectTasks(i.items, i.finalist), i.today, now),
    announcements: announcementStatus(last, now),
  };
}
