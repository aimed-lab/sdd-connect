// lib/server/teams/teamWorkRules.ts — the rules for replies on Progress updates
// and the team Tasks card, as plain functions.
//
// Tables: team_update_replies and team_tasks
// (database/migrations/2026-11-11_team_replies_tasks.sql). The database is the
// real gate (policies, the assignee trigger, CHECKs); these functions say the
// same thing in code for the UI and for `npm test`. No imports, so node can run
// the tests directly and client components may import this file.

// ── shared ───────────────────────────────────────────────────────────────────

/** Shown when a write fails because the migration has not been applied. */
export const TEAM_WORK_NOT_SET_UP = {
  replies: "Replies are not set up on this site yet. Ask the site admin to apply the team replies and tasks update.",
  tasks: "Tasks are not set up on this site yet. Ask the site admin to apply the team replies and tasks update.",
} as const;

/** True when a database error means the table does not exist yet (Postgres
 *  42P01, or PostgREST's "not in the schema cache"). */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

/** One line of text: line breaks and runs of spaces become one space. */
function oneLine(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

// ── dates (US Central) ───────────────────────────────────────────────────────
// Teams are at UAB, so the dates a team page shows (when an update or reply
// was posted) and "today" for Tasks (Today / Tomorrow / Overdue) are in US
// Central time, the way the CollaboFest project home decides "today"
// (lib/server/projectWorkspace/status.ts todayIso). Before this, they were
// UTC: at 6 PM Central on Nov 11 everything already read "Nov 12".

export const TEAM_TIME_ZONE = "America/Chicago";

/** Today as YYYY-MM-DD in US Central time. */
export function teamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A timestamp as "Nov 11, 2026" in US Central time ("" for a bad value). */
export function teamDay(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(ms))) {
    p[part.type] = part.value;
  }
  return `${p.month} ${p.day}, ${p.year}`;
}

// ── run once after mount ─────────────────────────────────────────────────────

/** Schedules `fn` to run once, on the next tick, for a React effect. The
 *  "already ran" mark is set only when `fn` actually runs. Returns the
 *  effect's cleanup.
 *
 *  Why: React Strict Mode (on in development) mounts, cleans up and mounts
 *  again. Setting the mark when scheduling and cancelling the timer in the
 *  cleanup meant the first timer was cancelled and the second mount saw the
 *  mark and did nothing, so `fn` never ran. Here the cancelled timer leaves
 *  the mark unset and the second mount's timer runs `fn`. */
export function runOnceAfterMount(
  ran: { current: boolean },
  fn: () => void,
  schedule: (cb: () => void) => unknown = (cb) => setTimeout(cb, 0),
  cancel: (handle: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
): () => void {
  if (ran.current) return () => {};
  const handle = schedule(() => {
    if (ran.current) return;
    ran.current = true;
    fn();
  });
  return () => cancel(handle);
}

// ── one-time team page params (?created=1, ?skipped=N, ?learn=1) ─────────────
// Set by the create form for the first visit only. They are removed from the
// URL through the Next router (router.replace), never window.history: Next's
// patched replaceState skips its own router state when the state object passed
// in carries its "__NA" marker (passing window.history.state does), so the
// router kept the old URL and wrote ?created=1&learn=1 back on the next server
// action refresh.

export const TEAM_ONE_TIME_PARAMS = ["created", "skipped", "learn"] as const;

/** The URL with the one-time params removed (other params and the hash kept). */
export function cleanTeamUrl(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  for (const p of TEAM_ONE_TIME_PARAMS) params.delete(p);
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

/** True when the URL still has one of the one-time params. */
export function hasTeamOneTimeParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return TEAM_ONE_TIME_PARAMS.some((p) => params.has(p));
}

type KeyStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** sessionStorage key: the creation wiki request was sent for this team. */
export function learnSentKey(slug: string): string {
  return `team-learn-sent:${slug}`;
}

/** sessionStorage key: the "Team created" notice was shown for this team. */
export function createdShownKey(slug: string): string {
  return `team-created-shown:${slug}`;
}

/** Was this one-time thing already done in this browser session? Storage that
 *  is missing or throws counts as "not done" (the router-side URL cleanup is
 *  then the only guard). */
export function onceDone(storage: KeyStore | null | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Remember that this one-time thing was done in this browser session. */
export function markOnceDone(storage: KeyStore | null | undefined, key: string): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // sessionStorage can be unavailable (private mode, blocked); nothing to do.
  }
}

/** Sends the creation wiki request for this team unless it was already sent
 *  in this browser session, and remembers that it was. Returns true when
 *  `send` ran. The mark is written before sending, so a send that throws is
 *  still not repeated. */
export function sendLearnOnce(storage: KeyStore | null | undefined, slug: string, send: () => void): boolean {
  const key = learnSentKey(slug);
  if (onceDone(storage, key)) return false;
  markOnceDone(storage, key);
  send();
  return true;
}

/** window.sessionStorage, or null where reading it throws. */
export function sessionStore(): KeyStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// ── replies ──────────────────────────────────────────────────────────────────

export const REPLY_TEXT_MAX = 1000;
/** With more replies than this, the list shows the latest ones and "Show all N replies". */
export const REPLIES_SHOWN = 3;

export type ReplyRow = { id: string; announcement_id: string; author_id: string; body: string; created_at: string };

export function parseReplyText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = oneLine(raw);
  if (!text) return { ok: false, error: "Write a reply first." };
  if (text.length > REPLY_TEXT_MAX) return { ok: false, error: `Keep the reply under ${REPLY_TEXT_MAX} letters.` };
  return { ok: true, text };
}

/** Replies grouped by the update they answer, each group oldest first (ties
 *  by id, so the order is stable). */
export function groupReplies<T extends ReplyRow>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[r.announcement_id] ??= []).push(r);
  for (const list of Object.values(out)) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }
  return out;
}

/** The replies shown under an update. Up to REPLIES_SHOWN: all of them. More:
 *  the latest REPLIES_SHOWN (still oldest first) and a "Show all N replies"
 *  button, until it is pressed. */
export function shownReplies<T>(replies: T[], expanded: boolean): { shown: T[]; showAllLabel: string | null } {
  if (expanded || replies.length <= REPLIES_SHOWN) return { shown: replies, showAllLabel: null };
  return { shown: replies.slice(-REPLIES_SHOWN), showAllLabel: `Show all ${replies.length} replies` };
}

/** The link under an update while its replies are closed: "Reply", or the count. */
export function replyToggleLabel(count: number): string {
  if (count <= 0) return "Reply";
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}

/** The author or a lead deletes a reply. */
export function canDeleteReply(v: { isLead: boolean; authorId: string; viewerId: string }): boolean {
  return v.isLead || (!!v.viewerId && v.authorId === v.viewerId);
}

// ── tasks ────────────────────────────────────────────────────────────────────

export const TASK_TEXT_MAX = 300;

export type TaskRow = {
  id: string;
  text: string;
  done: boolean;
  assignee_id: string | null;
  due_date: string | null; // YYYY-MM-DD
  position: number;
  created_at: string;
};

export function parseTaskText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = oneLine(raw);
  if (!text) return { ok: false, error: "Write the task first." };
  if (text.length > TASK_TEXT_MAX) return { ok: false, error: `Keep the task under ${TASK_TEXT_MAX} letters.` };
  return { ok: true, text };
}

/** A due date from the form: empty clears it; otherwise a real YYYY-MM-DD date. */
export function parseTaskDue(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: null };
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim()) : null;
  if (!m) return { ok: false, error: "Pick a valid date." };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: "Pick a valid date." };
  }
  return { ok: true, value: (raw as string).trim() };
}

/** An assignee from the form: empty is nobody; otherwise one of the team's
 *  members (the database checks it again). */
export function parseAssignee(raw: unknown, memberIds: string[]): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  if (typeof raw === "string" && memberIds.includes(raw)) return { ok: true, value: raw };
  return { ok: false, error: "Pick someone on the team." };
}

/** Open tasks first, by due date (undated last), then done tasks. Ties keep
 *  the list's own order (position, then oldest first). */
export function orderTasks<T extends TaskRow>(tasks: T[]): { open: T[]; done: T[] } {
  const byOrder = (a: T, b: T) =>
    a.position - b.position || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
  const open = tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.due_date && !b.due_date) return -1;
      if (!a.due_date && b.due_date) return 1;
      return byOrder(a, b);
    });
  const done = tasks.filter((t) => t.done).sort(byOrder);
  return { open, done };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The due date on a task row: "Today", "Tomorrow", "Nov 14" (with the year
 *  when it is not `today`'s year), and whether it is overdue (an OPEN task
 *  due before today). `today` is YYYY-MM-DD. Null for no or a bad date. */
export function taskDueLabel(
  due: string | null | undefined,
  today: string,
  done = false
): { text: string; overdue: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due ?? "");
  if (!m || !MONTHS[Number(m[2]) - 1]) return null;
  const overdue = !done && (due as string) < today;
  let text: string;
  if (due === today) text = "Today";
  else if (due === addDays(today, 1)) text = "Tomorrow";
  else {
    text = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
    if (m[1] !== today.slice(0, 4)) text += `, ${m[1]}`;
  }
  return { text: overdue ? `Overdue · ${text}` : text, overdue };
}
