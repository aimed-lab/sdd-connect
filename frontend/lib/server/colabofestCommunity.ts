// lib/server/colabofestCommunity.ts: the reads behind the CollaboFest 2026 community
// (rules in lib/server/communityHome/colabofest.ts).
//
// Who the VIEWER is comes from their own session (RLS, same as the project page):
// a project_members row on a project with program = 'colabofest_2026'. The lists
// that cover OTHER teams (everyone in the community, every project title) cannot
// be read through a team member's own session, so those two reads use the
// service-role client, and only AFTER the page has established that the viewer is a
// member of this community. They are read-only selects of a few columns each and
// never include a project's description or code in what they hand back to the page.

import { getCurrentUser, getDb } from "@/lib/auth";
import { COLABOFEST_PROGRAM } from "@/lib/projectTypes";
import { getServiceRoleClient } from "@/lib/server/supabaseServer";
import { mergePeople, type PersonRow, type ProjectSource } from "@/lib/server/communityHome/colabofest";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export type ColabofestViewer = {
  /** Ids of the CollaboFest projects the viewer has a project_members row on. */
  projectIds: string[];
  /** Has role 'manager' (SPARC team) on at least one of them. */
  isManager: boolean;
};

/** The signed-in viewer's own CollaboFest project memberships; empty when signed out. */
export async function getColabofestViewer(): Promise<ColabofestViewer> {
  const none = { projectIds: [], isManager: false };
  const user = await getCurrentUser();
  if (!user) return none;
  const db = await getDb();
  if (!db) return none;
  const { data: mine, error } = await db.from("project_members").select("project_id, role").eq("user_id", user.id);
  if (error || !mine || mine.length === 0) return none;
  const { data: projects } = await db
    .from("projects")
    .select("id")
    .in("id", (mine as Row[]).map((m) => m.project_id as string))
    .eq("program", COLABOFEST_PROGRAM);
  const ok = new Set(((projects ?? []) as Row[]).map((p) => p.id as string));
  const rows = (mine as Row[]).filter((m) => ok.has(m.project_id as string));
  return { projectIds: rows.map((m) => m.project_id as string), isManager: rows.some((m) => m.role === "manager") };
}

/** Every CollaboFest project (id, title, description line for ordering only). */
export async function listColabofestProjects(): Promise<ProjectSource[] | null> {
  const svc = getServiceRoleClient();
  if (!svc) return null;
  const { data, error } = await svc.from("projects").select("id, name, description").eq("program", COLABOFEST_PROGRAM);
  if (error || !data) return null;
  return (data as Row[]).map((p) => ({ id: p.id as string, name: (str(p.name) ?? "Untitled project"), description: str(p.description) }));
}

/** Everyone in the community: its community_members rows (active) plus everyone on a
 *  CollaboFest project, one entry per person. Hidden staff rows are left out, except
 *  the viewer's own. */
export async function listColabofestPeople(communityId: string, viewerUserId: string | null): Promise<PersonRow[]> {
  const svc = getServiceRoleClient();
  if (!svc) return [];

  const [cm, projects] = await Promise.all([
    svc.from("community_members").select("user_id, email, role, hidden, display_name, focus").eq("community_id", communityId).eq("status", "active"),
    svc.from("projects").select("id").eq("program", COLABOFEST_PROGRAM),
  ]);
  if (cm.error) return [];
  const projectIds = ((projects.data ?? []) as Row[]).map((p) => p.id as string);
  const pm = projectIds.length
    ? await svc.from("project_members").select("user_id, email").in("project_id", projectIds)
    : { data: [] as Row[], error: null };

  type Raw = { user_id: string | null; email: string | null; role: "admin" | "member"; hidden: boolean; display_name: string | null; focus: string | null };
  const raw: Raw[] = [
    ...((cm.data ?? []) as Row[]).map((r) => ({
      user_id: str(r.user_id),
      email: str(r.email),
      role: (r.role === "admin" ? "admin" : "member") as "admin" | "member",
      hidden: r.hidden === true,
      display_name: str(r.display_name),
      focus: str(r.focus),
    })),
    ...(((pm.error ? [] : pm.data) ?? []) as Row[]).map((r) => ({
      user_id: str(r.user_id),
      email: str(r.email),
      role: "member" as const,
      hidden: false,
      display_name: null,
      focus: null,
    })),
  ];

  // Names and institutions from the accounts; an email-only row is matched to an
  // account by its email when there is one.
  const ids = [...new Set(raw.map((r) => r.user_id).filter((v): v is string => !!v))];
  const emails = [...new Set(raw.filter((r) => !r.user_id && r.email).map((r) => r.email!.trim().toLowerCase()))];
  const [byId, byEmail] = await Promise.all([
    ids.length ? svc.from("users").select("id, name, email, institution").in("id", ids) : Promise.resolve({ data: [] as Row[] }),
    emails.length ? svc.from("users").select("id, name, email, institution").in("email", emails) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const users = new Map<string, Row>();
  for (const u of [...((byId.data ?? []) as Row[]), ...((byEmail.data ?? []) as Row[])]) users.set(u.id as string, u);
  const idByEmail = new Map<string, string>();
  for (const u of users.values()) {
    const e = str(u.email)?.toLowerCase();
    if (e) idByEmail.set(e, u.id as string);
  }

  const rows: PersonRow[] = raw.map((r) => {
    const user_id = r.user_id ?? (r.email ? idByEmail.get(r.email.trim().toLowerCase()) ?? null : null);
    const u = user_id ? users.get(user_id) : undefined;
    return {
      user_id,
      email: r.email ?? str(u?.email),
      name: str(u?.name) ?? r.display_name,
      institution: str(u?.institution),
      focus: r.focus,
      role: r.role,
      hidden: r.hidden,
    };
  });
  return mergePeople(rows).filter((p) => !p.hidden || (!!viewerUserId && p.user_id === viewerUserId));
}
