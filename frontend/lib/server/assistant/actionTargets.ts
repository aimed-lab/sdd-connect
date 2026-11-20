// lib/server/assistant/actionTargets.ts — which of the person's OWN places (communities,
// teams, projects) a request means: "add xyz@gmail.com to ABCD" (add-member flow) or
// "add this to the Savannah 2026 community" (file flow). Pure, so `npm test` covers it;
// the rows come from app/explore/assistantActions.ts, read with the person's own session.
//
// Each flow passes its own "allowed" rule: canAddMembersTo (team admin; project lead or
// manager) or canAddFileTo (community admin; any active team member; any project member).
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

/** A place something can be added to. The add-member flow uses team and project only. */
export type PlaceType = "community" | "team" | "project";

export type TargetRow = {
  type: PlaceType;
  id: string;
  name: string;
  /** A community's or team's slug, for its link; null for a project. */
  slug: string | null;
  memberCount: number;
  /** The person's role: community_members.role, or project_members.role. */
  role: string;
  /** "C-103" for a CollaboFest project, else null. */
  code: string | null;
  /** An invite-only community (CollaboFest): no join link or QR is offered. */
  inviteOnly?: boolean;
  /** A community that lets people join straight away (teams always do). False: joining
   *  is a request an admin approves. */
  isOpen?: boolean;
};

export type TargetCandidate = {
  type: PlaceType;
  id: string;
  name: string;
  slug: string | null;
  memberCount: number;
  code: string | null;
  inviteOnly: boolean;
  isOpen: boolean;
  /** Where the card links to. */
  href: string;
};

export type TargetMatch = {
  candidates: TargetCandidate[];
  /** Matches the person is on but can't do this in. */
  notAllowed: { type: PlaceType; name: string }[];
};

/** May this person add members here today? (Teams and projects only.) */
export function canAddMembersTo(row: Pick<TargetRow, "type" | "role">): boolean {
  if (row.type === "team") return row.role === "admin";
  if (row.type === "project") return row.role === "lead" || row.role === "manager";
  return false;
}

/** May this person add a file here today? The same rules as the server:
 *  addCommunityResourceFile / createCommunityResource (a community: its admin; a team:
 *  any active member; the rows are active memberships only) and recordProjectFile (a
 *  project: any member). */
export function canAddFileTo(row: Pick<TargetRow, "type" | "role">): boolean {
  if (row.type === "community") return row.role === "admin";
  return true;
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
  if (row.type === "team") return `/teams/${row.slug ?? ""}`;
  if (row.type === "community") return `/communities/${row.slug ?? ""}`;
  return `/projects/${row.id}`;
}

function toCandidate(r: TargetRow): TargetCandidate {
  return {
    type: r.type,
    id: r.id,
    name: r.name,
    slug: r.slug,
    memberCount: r.memberCount,
    code: r.code,
    inviteOnly: !!r.inviteOnly,
    isOpen: r.isOpen ?? true,
    href: hrefFor(r),
  };
}

const TYPE_ORDER: Record<PlaceType, number> = { community: 0, team: 1, project: 2 };

function byTypeThenName(a: TargetRow, b: TargetRow): number {
  return TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name);
}

/** Every place this person may use, for "add this" with no place named: a picker,
 *  nothing chosen. */
export function allowedPlaces(rows: TargetRow[], allowed: (r: TargetRow) => boolean = canAddFileTo): TargetCandidate[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const k = `${r.type}:${r.id}`;
      if (seen.has(k) || !allowed(r)) return false;
      seen.add(k);
      return true;
    })
    .sort(byTypeThenName)
    .map(toCandidate);
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
export function matchTargets(
  rows: TargetRow[],
  targetName: string,
  targetType: PlaceType | null,
  allowed: (r: TargetRow) => boolean = canAddMembersTo
): TargetMatch {
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
    candidates: unique.filter(allowed).sort(byTypeThenName).map(toCandidate),
    notAllowed: unique.filter((r) => !allowed(r)).map((r) => ({ type: r.type, name: r.name })),
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
