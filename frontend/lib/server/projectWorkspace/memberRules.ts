// lib/server/projectWorkspace/memberRules.ts: what a LEAD may NOT do to the team on a
// program project (projects.program set, e.g. 'colabofest_2026'). Pure, so `npm test`
// covers it; lib/server/projects.ts (addProjectMember, removeProjectMember,
// promoteProjectMember, setMemberRole) calls it after its own lead / manager checks.
//
// On a program project the SPARC team (role 'manager') runs the roster's roles, so a lead
// may only add and remove PLAIN members: no adding a manager or lead, no removing a
// manager or lead, no promoting, no role changes. On an ordinary project (program null)
// nothing here applies and a lead keeps every power it has today. A manager is never
// affected by this file: its own limits (members only) stay in projects.ts unchanged.
//
// This is the app-layer gate. RLS on project_members does not know about program yet.

export type MemberChange =
  | { kind: "add"; role: string }
  | { kind: "remove"; targetRole: string }
  | { kind: "promote" }
  | { kind: "set_role" };

function programProjects(program: string): string {
  return program === "colabofest_2026" ? "CollaboFest projects" : "program projects";
}

/** The refusal for this change, or null when it may go ahead (the caller's other
 *  checks still apply). */
export function programLeadRefusal(args: {
  program: string | null | undefined;
  callerRole: "lead" | "manager";
  change: MemberChange;
}): string | null {
  const { program, callerRole, change } = args;
  if (!program || callerRole !== "lead") return null;
  const where = programProjects(program);
  switch (change.kind) {
    case "add":
      return change.role === "member" ? null : `On ${where}, leads can add members only. The SPARC team manages roles.`;
    case "remove":
      return change.targetRole === "member"
        ? null
        : `On ${where}, leads can remove members only. The SPARC team manages roles.`;
    case "promote":
    case "set_role":
      return `On ${where}, the SPARC team manages roles.`;
  }
}
