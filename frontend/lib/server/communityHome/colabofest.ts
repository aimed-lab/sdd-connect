// lib/server/communityHome/colabofest.ts: the pure rules of the CollaboFest 2026
// community (no I/O, no next/* imports, so `npm test` covers them and client
// components may import them).
//
//   * It is INVITE ONLY: no join button, no QR, no "Open to join".
//   * Its members are the community_members rows PLUS everyone on a CollaboFest
//     project (project_members), merged without duplicates.
//   * Its Projects view lists project titles only, in code order (C-101, C-102 ...),
//     and links only the viewer's own project (staff and admins: all of them).

export const COLABOFEST_COMMUNITY_SLUG = "colabofest-2026";

/** Shown instead of the stored description (which still describes open membership). */
export const COLABOFEST_DESCRIPTION = "SPARC's drug discovery challenge. Each team works in its own private project.";

export function isColabofestCommunity(slug: string | null | undefined): boolean {
  return slug === COLABOFEST_COMMUNITY_SLUG;
}

/** The text to show for a community's description. */
export function communityDescription(slug: string, stored: string | null): string | null {
  return isColabofestCommunity(slug) ? COLABOFEST_DESCRIPTION : stored;
}

// ── members ──────────────────────────────────────────────────────────────────

export type PersonRow = {
  user_id: string | null;
  email: string | null;
  name: string | null;
  institution: string | null;
  focus: string | null;
  role: "admin" | "member";
  hidden?: boolean;
};

/** Same person = same user id, else the same lowercased email. */
export function personKey(p: { user_id: string | null; email: string | null }): string {
  return p.user_id ? `u:${p.user_id}` : `e:${(p.email ?? "").trim().toLowerCase()}`;
}

/** One row per person. Admin wins over member; a row with a name, institution or
 *  focus fills gaps in the other. A row with neither id nor email is dropped. */
export function mergePeople(rows: PersonRow[]): PersonRow[] {
  const byKey = new Map<string, PersonRow>();
  for (const r of rows) {
    if (!r.user_id && !(r.email ?? "").trim()) continue;
    const k = personKey(r);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...r });
      continue;
    }
    byKey.set(k, {
      user_id: prev.user_id ?? r.user_id,
      email: prev.email ?? r.email,
      name: prev.name || r.name,
      institution: prev.institution || r.institution,
      focus: prev.focus || r.focus,
      role: prev.role === "admin" || r.role === "admin" ? "admin" : "member",
      hidden: !!prev.hidden && !!r.hidden,
    });
  }
  return [...byKey.values()];
}

/** A usable display name: something other than an email address. */
export function realName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n && !n.includes("@") ? n : null;
}

/** People with a real name are listed (their email is dropped here, so it can never
 *  reach the page); everyone else is only counted. The total is unchanged. */
export function splitNamed(people: PersonRow[]): { named: PersonRow[]; unnamedCount: number } {
  const named: PersonRow[] = [];
  let unnamedCount = 0;
  for (const p of people) {
    const name = realName(p.name);
    if (name) named.push({ ...p, name, email: null });
    else unnamedCount += 1;
  }
  return { named, unnamedCount };
}

// ── projects ─────────────────────────────────────────────────────────────────

/** The "C-108" part of a project's description line ("CollaboFest 2026 · C-108"). */
export function projectCode(description: string | null | undefined): string | null {
  return (description ?? "").match(/\bC-(\d+)\b/)?.[0] ?? null;
}

export type ProjectSource = { id: string; name: string; description: string | null };

/** A row of the Projects view. Only the title is ever sent; a project the viewer
 *  cannot open has no id at all, so there is nothing to link to. */
export type ProjectRow = { name: string; id: string | null; mine: boolean };

/** Code order (C-101 first; no code last, by title), then the viewer's own projects
 *  moved to the top. */
export function buildProjectRows(
  projects: ProjectSource[],
  args: { myProjectIds: readonly string[]; openAll: boolean }
): ProjectRow[] {
  const mineSet = new Set(args.myProjectIds);
  const num = (p: ProjectSource) => {
    const c = projectCode(p.description);
    return c ? Number(c.slice(2)) : Number.POSITIVE_INFINITY;
  };
  const sorted = projects
    .slice()
    .sort((a, b) => (num(a) === num(b) ? a.name.localeCompare(b.name) : num(a) < num(b) ? -1 : 1));
  const rows = sorted.map((p) => {
    const mine = mineSet.has(p.id);
    return { name: p.name, id: mine || args.openAll ? p.id : null, mine };
  });
  return [...rows.filter((r) => r.mine), ...rows.filter((r) => !r.mine)];
}
