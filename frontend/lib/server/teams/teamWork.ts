// lib/server/teams/teamWork.ts — replies on Progress updates and the team
// Tasks card (database/migrations/2026-11-11_team_replies_tasks.sql).
//
// Every call uses the signed-in person's own session, so row level security is
// the real gate; the checks here are for clear messages. Team-only: each write
// first checks the row is a team and the caller an active member
// (requireTeamMember); communities never reach these tables.
//
// BEFORE THE MIGRATION IS APPLIED the tables don't exist. A failed read is "no
// replies" / "no tasks" (the page looks as it did), and a failed write returns
// TEAM_WORK_NOT_SET_UP, a plain sentence saying the feature isn't set up yet.

import { unstable_noStore as noStore } from "next/cache";
import { getSession, requireCurrentUser } from "@/lib/auth";
import { listMemberRoster } from "@/lib/server/communities";
import { requireTeamMember, type TeamWriteResult } from "./teams";
import {
  TEAM_WORK_NOT_SET_UP,
  isMissingTableError,
  parseAssignee,
  parseReplyText,
  parseTaskDue,
  parseTaskText,
  type ReplyRow,
  type TaskRow,
} from "./teamWorkRules";

type DbError = { code?: string | null; message?: string | null } | null;

function writeError(what: "replies" | "tasks", error: DbError, fallback: string): string {
  if (isMissingTableError(error)) return TEAM_WORK_NOT_SET_UP[what];
  if (error?.code === "42501") {
    return /assignee/i.test(error.message ?? "")
      ? "The person you picked is not on the team any more."
      : "Only team members can do this.";
  }
  return fallback;
}

// ── replies ──────────────────────────────────────────────────────────────────

/** Every reply in this team, oldest first. [] when the table isn't there yet,
 *  or on any read error. */
export async function listProgressReplies(teamId: string): Promise<ReplyRow[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db
    .from("team_update_replies")
    .select("id, announcement_id, author_id, body, created_at")
    .eq("community_id", teamId)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) {
    if (!isMissingTableError(error)) console.error("listProgressReplies failed", error);
    return [];
  }
  return (data ?? []) as ReplyRow[];
}

/** Reply to a progress update. Any active member; the policy also checks the
 *  update is a tagged row of this same team. */
export async function postProgressReply(teamId: string, updateId: string, body: string): Promise<TeamWriteResult> {
  const { user, db } = await requireCurrentUser();
  const who = await requireTeamMember(teamId);
  if (!who.ok) return { status: "error", error: who.error };
  const text = parseReplyText(body);
  if (!text.ok) return { status: "error", error: text.error };

  const { error } = await db
    .from("team_update_replies")
    .insert({ announcement_id: updateId, community_id: teamId, author_id: user.id, body: text.text });
  if (error) {
    console.error("postProgressReply: insert failed", error);
    return { status: "error", error: writeError("replies", error, "Couldn't post the reply. Please try again.") };
  }
  return { status: "ok" };
}

/** Delete a reply: its author or a lead (RLS; anyone else matches zero rows). */
export async function deleteProgressReply(teamId: string, replyId: string): Promise<TeamWriteResult> {
  const { db } = await requireCurrentUser();
  const who = await requireTeamMember(teamId);
  if (!who.ok) return { status: "error", error: who.error };

  const { data, error } = await db
    .from("team_update_replies")
    .delete()
    .eq("id", replyId)
    .eq("community_id", teamId)
    .select("id");
  if (error) {
    console.error("deleteProgressReply: delete failed", error);
    return { status: "error", error: writeError("replies", error, "Couldn't delete the reply. Please try again.") };
  }
  if (!data || data.length === 0) {
    return { status: "error", error: "Only the person who wrote this, or a team lead, can delete it." };
  }
  return { status: "ok" };
}

// ── tasks ────────────────────────────────────────────────────────────────────

/** The team's tasks. [] when the table isn't there yet, or on any read error. */
export async function listTeamTasks(teamId: string): Promise<TaskRow[]> {
  noStore();
  const session = await getSession();
  if (!session) return [];
  const { data, error } = await session.db
    .from("team_tasks")
    .select("id, text, done, assignee_id, due_date, position, created_at")
    .eq("community_id", teamId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    if (!isMissingTableError(error)) console.error("listTeamTasks failed", error);
    return [];
  }
  return (data ?? []) as TaskRow[];
}

/** The team's members with an account (an assignee must be one of them). Read
 *  here, never taken from the caller; the database trigger checks it again. */
async function memberIds(teamId: string): Promise<string[]> {
  const roster = await listMemberRoster(teamId);
  return roster.map((m) => m.user_id).filter((id): id is string => !!id);
}

/** Add a task: text, optional assignee (a team member), optional due date. */
export async function addTeamTask(
  teamId: string,
  input: { text: unknown; assignee: unknown; due: unknown }
): Promise<TeamWriteResult> {
  const { user, db } = await requireCurrentUser();
  const who = await requireTeamMember(teamId);
  if (!who.ok) return { status: "error", error: who.error };
  const text = parseTaskText(input.text);
  if (!text.ok) return { status: "error", error: text.error };
  const due = parseTaskDue(input.due);
  if (!due.ok) return { status: "error", error: due.error };
  const assignee = input.assignee ? parseAssignee(input.assignee, await memberIds(teamId)) : parseAssignee(null, []);
  if (!assignee.ok) return { status: "error", error: assignee.error };

  const { error } = await db.from("team_tasks").insert({
    community_id: teamId,
    text: text.text,
    assignee_id: assignee.value,
    due_date: due.value,
    created_by: user.id,
  });
  if (error) {
    console.error("addTeamTask: insert failed", error);
    return { status: "error", error: writeError("tasks", error, "Couldn't add the task. Please try again.") };
  }
  return { status: "ok" };
}

export type TaskPatch = { done?: unknown; assignee?: unknown; due?: unknown };

/** Tick, reassign or re-date a task. Any active member. */
export async function updateTeamTask(
  teamId: string,
  taskId: string,
  patch: TaskPatch
): Promise<TeamWriteResult> {
  const { db } = await requireCurrentUser();
  const who = await requireTeamMember(teamId);
  if (!who.ok) return { status: "error", error: who.error };

  const row: Record<string, unknown> = {};
  if (patch.done !== undefined) row.done = patch.done === true;
  if (patch.due !== undefined) {
    const due = parseTaskDue(patch.due);
    if (!due.ok) return { status: "error", error: due.error };
    row.due_date = due.value;
  }
  if (patch.assignee !== undefined) {
    const assignee = patch.assignee ? parseAssignee(patch.assignee, await memberIds(teamId)) : parseAssignee(null, []);
    if (!assignee.ok) return { status: "error", error: assignee.error };
    row.assignee_id = assignee.value;
  }
  if (Object.keys(row).length === 0) return { status: "ok" };

  const { data, error } = await db
    .from("team_tasks")
    .update(row)
    .eq("id", taskId)
    .eq("community_id", teamId)
    .select("id");
  if (error) {
    console.error("updateTeamTask: update failed", error);
    return { status: "error", error: writeError("tasks", error, "Couldn't save that. Please try again.") };
  }
  if (!data || data.length === 0) return { status: "error", error: "That task is gone. Reload the page." };
  return { status: "ok" };
}

/** Delete a task. Any active member. */
export async function deleteTeamTask(teamId: string, taskId: string): Promise<TeamWriteResult> {
  const { db } = await requireCurrentUser();
  const who = await requireTeamMember(teamId);
  if (!who.ok) return { status: "error", error: who.error };

  const { data, error } = await db
    .from("team_tasks")
    .delete()
    .eq("id", taskId)
    .eq("community_id", teamId)
    .select("id");
  if (error) {
    console.error("deleteTeamTask: delete failed", error);
    return { status: "error", error: writeError("tasks", error, "Couldn't delete the task. Please try again.") };
  }
  if (!data || data.length === 0) return { status: "error", error: "That task is gone. Reload the page." };
  return { status: "ok" };
}
