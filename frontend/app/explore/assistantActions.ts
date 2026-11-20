"use server";

// Server Actions for the Explore assistant's add-member card
// (components/explore/ActionCards.tsx) and add-file card (FileActionCards.tsx). READ-ONLY: this finds which of the person's
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
  allowedPlaces,
  canAddFileTo,
  matchTargets,
  noTargetMessage,
  projectCode,
  type PlaceType,
  type TargetCandidate,
  type TargetRow,
} from "@/lib/server/assistant/actionTargets";
import type { TargetType } from "@/lib/server/assistant/actionIntent";
import { isSiteAdmin } from "@/lib/server/showcase";
import { isColabofestCommunity } from "@/lib/server/communityHome/colabofest";

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

// ── the file flow: "add this file to <community, team or project>" ───────────

/** The person's active community and team memberships, with their role. */
async function myCommunityRows(): Promise<TargetRow[]> {
  const { user, db } = await requireCurrentUser();
  const { data, error } = await db
    .from("community_members")
    .select("role, communities(id, slug, name, kind, is_open)")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (error || !data) {
    if (error) console.error("resolveFilePlace: community lookup failed", error);
    return [];
  }
  type C = { id: string; slug: string; name: string; kind: string; is_open: boolean };
  const rows = (data as { role: string; communities: C | C[] | null }[])
    .map((r) => ({ role: r.role, c: one(r.communities) }))
    .filter((r): r is { role: string; c: C } => !!r.c);
  if (rows.length === 0) return [];

  const counts = new Map<string, number>();
  const res = await db.rpc("community_member_counts");
  if (!res.error && Array.isArray(res.data)) {
    for (const r of res.data as { community_id: string; member_count: number | string }[]) {
      counts.set(r.community_id, Number(r.member_count) || 0);
    }
  }
  return rows.map((r) => ({
    type: r.c.kind === "team" ? ("team" as const) : ("community" as const),
    id: r.c.id,
    name: r.c.name,
    slug: r.c.slug,
    memberCount: counts.get(r.c.id) ?? 0,
    role: r.role,
    code: null,
    inviteOnly: r.c.kind !== "team" && isColabofestCommunity(r.c.slug),
    isOpen: r.c.kind === "team" ? true : r.c.is_open !== false,
  }));
}

export type ResolveFilePlaceResult =
  | {
      ok: true;
      /** The places the name means (or every place, when no name was given). */
      candidates: TargetCandidate[];
      /** Every place the person may add a file to, for "Pick another place". */
      all: TargetCandidate[];
      named: boolean;
      siteAdmin: boolean;
    }
  | { ok: false; error: string };

/** Where "add this file to X" can go: the person's own places where they may add a
 *  file today (canAddFileTo). `slug` finds one just created (a new community or team).
 *  Read-only; nothing is uploaded or created here. */
export async function resolveFilePlaceAction(input: {
  targetName: string | null;
  targetType: PlaceType | null;
  slug?: string | null;
}): Promise<ResolveFilePlaceResult> {
  const name = typeof input?.targetName === "string" ? input.targetName.trim().slice(0, 120) : "";
  const t = input?.targetType;
  const type: PlaceType | null = t === "community" || t === "team" || t === "project" ? t : null;
  const slug = typeof input?.slug === "string" ? input.slug.trim() : "";
  try {
    const [communities, projects, siteAdmin] = await Promise.all([myCommunityRows(), myProjectRows(), isSiteAdmin()]);
    const rows = [...communities, ...projects];
    const all = allowedPlaces(rows, canAddFileTo);
    if (slug) {
      return { ok: true, candidates: all.filter((c) => c.slug === slug), all, named: true, siteAdmin };
    }
    if (!name) return { ok: true, candidates: all, all, named: false, siteAdmin };
    const match = matchTargets(rows, name, type, canAddFileTo);
    return { ok: true, candidates: match.candidates, all, named: true, siteAdmin };
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in first." };
    console.error("resolveFilePlaceAction failed", e);
    return { ok: false, error: "Couldn't look up your communities, teams and projects. Please try again." };
  }
}
