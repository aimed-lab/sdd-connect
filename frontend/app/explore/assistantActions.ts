"use server";

// Server Actions for the Explore assistant's add-member card
// (components/explore/ActionCards.tsx). READ-ONLY: this finds which of the person's
// own teams and projects a request means. Adding someone is the existing actions'
// job (addCommunityMemberByEmailAction, addMemberAction), called only when the person
// presses Confirm, and they check permissions again.
//
// Everything is read with the signed-in person's own session, so RLS returns only
// teams and projects they are on. The matching and the role filter are
// lib/server/assistant/actionTargets.ts.

import { UnauthorizedError, requireCurrentUser } from "@/lib/auth";
import { listMyTeams } from "@/lib/server/teams/teams";
import {
  matchTargets,
  noTargetMessage,
  projectCode,
  type TargetCandidate,
  type TargetRow,
} from "@/lib/server/assistant/actionTargets";
import type { TargetType } from "@/lib/server/assistant/actionIntent";

export type ResolveTargetResult =
  | { ok: true; candidates: TargetCandidate[]; message: string | null }
  | { ok: false; error: string };

type ProjectEmbed = { id: string; name: string; description: string | null; program: string | null };

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** The person's projects with their own role on each (lead / manager / member). */
async function myProjectRows(): Promise<TargetRow[]> {
  const { user, db } = await requireCurrentUser();
  const { data, error } = await db
    .from("project_members")
    .select("role, projects(id, name, description, program)")
    .eq("user_id", user.id);
  if (error || !data) {
    if (error) console.error("resolveAddMemberTarget: project lookup failed", error);
    return [];
  }
  const rows = (data as { role: string; projects: ProjectEmbed | ProjectEmbed[] | null }[])
    .map((r) => ({ role: r.role, p: one(r.projects) }))
    .filter((r): r is { role: string; p: ProjectEmbed } => !!r.p);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.p.id);
  const counts = new Map<string, number>();
  const { data: members } = await db.from("project_members").select("project_id").in("project_id", ids);
  for (const m of (members ?? []) as { project_id: string }[]) counts.set(m.project_id, (counts.get(m.project_id) ?? 0) + 1);

  return rows.map((r) => ({
    type: "project" as const,
    id: r.p.id,
    name: r.p.name,
    slug: null,
    memberCount: counts.get(r.p.id) ?? 0,
    role: r.role,
    code: r.p.program ? projectCode(r.p.description) : null,
  }));
}

async function myTeamRows(): Promise<TargetRow[]> {
  const teams = await listMyTeams();
  return teams.map((t) => ({
    type: "team" as const,
    id: t.id,
    name: t.name,
    slug: t.slug,
    memberCount: t.member_count,
    role: t.role,
    code: null,
  }));
}

/** Which of the person's teams / projects "targetName" means, among those they may
 *  add members to today. 0, 1 or several candidates; never a choice made for them. */
export async function resolveAddMemberTargetAction(input: {
  targetName: string;
  targetType: TargetType | null;
}): Promise<ResolveTargetResult> {
  const name = typeof input?.targetName === "string" ? input.targetName.trim().slice(0, 120) : "";
  const type = input?.targetType === "team" || input?.targetType === "project" ? input.targetType : null;
  if (!name) return { ok: false, error: "Which team or project?" };
  try {
    const [teams, projects] = await Promise.all([
      type === "project" ? Promise.resolve([]) : myTeamRows(),
      type === "team" ? Promise.resolve([]) : myProjectRows(),
    ]);
    const match = matchTargets([...teams, ...projects], name, type);
    return { ok: true, candidates: match.candidates, message: match.candidates.length === 0 ? noTargetMessage(name, match) : null };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in first." };
    console.error("resolveAddMemberTargetAction failed", e);
    return { ok: false, error: "Couldn't look up your teams and projects. Please try again." };
  }
}
