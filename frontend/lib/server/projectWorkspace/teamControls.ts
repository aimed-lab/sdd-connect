// lib/server/projectWorkspace/teamControls.ts: which member controls the Team view of a
// CollaboFest project shows (components/projects/workspace/ProjectTeamView.tsx). Pure, so
// `npm test` covers it.
//
// A lead or a manager (the SPARC team) may add ordinary members by email and remove
// ordinary members. Nobody gets a control here to add a manager, remove a manager or a
// lead, or change anyone's role: those stay on the old Team section of an ordinary
// project. lib/server/projects.ts and RLS are the real gate; this only decides what is
// shown.

export type TeamControls = {
  /** "Add a member by email" (always adds role 'member'). */
  canAdd: boolean;
  /** "Remove" on a row with this role. */
  canRemove: (memberRole: string) => boolean;
};

export function canManageMembers(viewerRole: string | null | undefined): boolean {
  return viewerRole === "lead" || viewerRole === "manager";
}

/** The controls for a viewer, from canManageMembers(their role). */
export function teamControls(manage: boolean): TeamControls {
  return {
    canAdd: manage,
    canRemove: (memberRole) => manage && memberRole === "member",
  };
}

/** The status shown after the role for someone added by email who has no linked
 *  account yet (project_members.user_id is null). */
export const INVITED_LABEL = "Invited, not signed in yet";

/** The line under the add form: nothing is emailed, so the adder has to tell them. */
export const NO_EMAIL_NOTE =
  "No email is sent. Ask them to sign in at connect.smartdrugdiscovery.org with this email to see the project.";
