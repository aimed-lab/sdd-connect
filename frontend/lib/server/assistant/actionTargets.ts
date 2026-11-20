// lib/server/assistant/actionTargets.ts — which of the person's OWN teams and projects
// an add-member request ("add xyz@gmail.com to ABCD") means. Pure, so `npm test`
// covers it; the rows come from app/explore/assistantActions.ts, read with the
// person's own session.
//
// THE RULES:
//   * Only teams and projects the person is already on are ever considered. The model
//     never picks one and never sees an id.
//   * Only those where the person may add members TODAY are offered: a team they are
//     the admin (lead) of (addCommunityMemberByEmail requires is_community_admin), a
//     project they lead or manage (addProjectMember). Matches they can't manage are
//     counted, so the card can say why there is no choice.
//   * The name is compared as words, ignoring case and punctuation. For a CollaboFest
//     project the code in its description (e.g. "C-103") matches too.
//   * Exact matches win; only when there are none are partial ones offered. Several
//     candidates are returned as they are: the card shows a picker, never a guess.

import type { TargetType } from "./actionIntent.ts";

export type TargetRow = {
  type: TargetType;
  id: string;
  name: string;
  /** A team's slug, for its link; null for a project. */
  slug: string | null;
  memberCount: number;
  /** The person's role: a team's community_members.role, a project's project_members.role. */
  role: string;
  /** "C-103" for a CollaboFest project, else null. */
  code: string | null;
};

export type TargetCandidate = {
  type: TargetType;
  id: string;
  name: string;
  slug: string | null;
  memberCount: number;
  code: string | null;
  /** Where the card links to. */
  href: string;
};

export type TargetMatch = {
  candidates: TargetCandidate[];
  /** Matches the person is on but can't add members to. */
  notAllowed: { type: TargetType; name: string }[];
};

/** May this person add members here today? */
export function canAddMembersTo(row: Pick<TargetRow, "type" | "role">): boolean {
  return row.type === "team" ? row.role === "admin" : row.role === "lead" || row.role === "manager";
}

/** The CollaboFest code (C-###) in a project's description, or null. */
export function projectCode(description: string | null | undefined): string | null {
  return (description ?? "").match(/\bC-\d+\b/i)?.[0]?.toUpperCase() ?? null;
}

function words(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "the ABCD team" -> "abcd". */
function cleanQuery(q: string): string {
  let w = words(q).replace(/^(the|my|our)\s+/, "");
  // A trailing or leading "team" / "project" is the type, not part of the name,
  // unless it is all there is.
  const stripped = w.replace(/\s+(team|project)$/, "").replace(/^(team|project)\s+/, "");
  return (stripped || w).trim();
}

function hrefFor(row: TargetRow): string {
  return row.type === "team" ? `/teams/${row.slug ?? ""}` : `/projects/${row.id}`;
}

type Strength = "exact" | "partial" | null;

function strength(row: TargetRow, q: string): Strength {
  if (!q) return null;
  const name = words(row.name);
  const code = row.code ? words(row.code) : null;
  if (name === q || (code && code === q)) return "exact";
  // The query's words appear in the name ("abcd" in "abcd lab"), or the code appears in the query.
  if (` ${name} `.includes(` ${q} `)) return "partial";
  if (code && ` ${q} `.includes(` ${code} `)) return "partial";
  return null;
}

/** The person's teams and projects that this name means, split into those they may add
 *  members to (candidates) and those they may not. */
export function matchTargets(rows: TargetRow[], targetName: string, targetType: TargetType | null): TargetMatch {
  const q = cleanQuery(targetName);
  const pool = rows.filter((r) => targetType === null || r.type === targetType);
  const scored = pool.map((r) => ({ r, s: strength(r, q) })).filter((x) => x.s !== null);
  const exact = scored.filter((x) => x.s === "exact");
  const chosen = (exact.length > 0 ? exact : scored).map((x) => x.r);

  const seen = new Set<string>();
  const unique = chosen.filter((r) => {
    const k = `${r.type}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    candidates: unique
      .filter(canAddMembersTo)
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
      .map((r) => ({ type: r.type, id: r.id, name: r.name, slug: r.slug, memberCount: r.memberCount, code: r.code, href: hrefFor(r) })),
    notAllowed: unique.filter((r) => !canAddMembersTo(r)).map((r) => ({ type: r.type, name: r.name })),
  };
}

/** The card's message when there is nothing to pick. */
export function noTargetMessage(targetName: string, match: TargetMatch): string {
  const shown = targetName.trim();
  if (match.notAllowed.length > 0) {
    const n = match.notAllowed[0];
    return n.type === "team"
      ? `You're on the team "${n.name}", but only its lead can add people.`
      : `You're on the project "${n.name}", but only its leads and the SPARC team can add people.`;
  }
  return `You don't lead a team or project called ${shown}.`;
}
