// lib/server/projectWorkspace/cfHome.ts: the small texts on a ColaboFest project's home
// (components/projects/workspace/ColabofestProject.tsx): the grey status line under each
// tile, and the "More you can do here" cards. Pure, so `npm test` covers it.

import { FINALIST_DUE } from "../../colabofestConfig.ts";

export type CfTileKey = "tasks" | "files" | "announcements" | "team" | "timeline" | "manage";

/** The line under each tile's name, from what the page already has loaded. null: no line.
 *
 *  Tasks, for a finalist, counts the finalist tasks (the same number as the tile's badge
 *  and the banner) and names their due date. For another team it counts every list and
 *  names no date (there is no single one); with no tasks at all there is no line. */
export function tileStatusLines(a: {
  finalist: boolean;
  finalistDone: number;
  finalistTotal: number;
  /** Over all three lists (the Progress card's numbers). */
  tasksDone: number;
  tasksTotal: number;
  hasFolder: boolean;
  /** Announcements posted in the last week. */
  announcementsNew: number;
  memberCount: number;
  /** The next program date as shown ("Nov 13"), or null once the last has passed. */
  nextDateShown: string | null;
}): Record<CfTileKey, string | null> {
  let tasks: string | null;
  if (a.finalist) {
    const left = Math.max(0, a.finalistTotal - a.finalistDone);
    tasks = left > 0 ? `${left} to do · due ${FINALIST_DUE.shown}` : "All done";
  } else if (a.tasksTotal <= 0) {
    tasks = null;
  } else {
    const left = Math.max(0, a.tasksTotal - a.tasksDone);
    tasks = left > 0 ? `${left} to do` : "All done";
  }
  return {
    tasks,
    files: a.hasFolder ? "Open your Box folder" : "Not linked yet",
    // The tile's badge already shows the count ("2 new").
    announcements: a.announcementsNew > 0 ? "New this week" : "Nothing new",
    team: `${a.memberCount} ${a.memberCount === 1 ? "member" : "members"}`,
    timeline: a.nextDateShown ? `Next: ${a.nextDateShown}` : null,
    manage: "Links and settings",
  };
}

/** "More you can do here": four links to the rest of the site. `icon` is a Material Symbols name. */
export const MORE_LINKS = [
  { title: "Search the research", text: "Papers, trials, compounds and datasets in one search.", href: "/explore", icon: "search", tint: "green" },
  { title: "Follow your topic", text: "A wiki page that adds new papers and datasets every day.", href: "/pages", icon: "article", tint: "purple" },
  { title: "Find a service provider", text: "Need synthesis, docking or protein expression done? See who can do it.", href: "/collaborate", icon: "handshake", tint: "blue" },
  { title: "Share your result", text: "Turn a finished paper or finding into a post for the community.", href: "/promote", icon: "campaign", tint: "amber" },
] as const;
