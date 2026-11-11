// Run with `npm test`. The status line under each ColaboFest tile, and the "More you can do here" cards.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MORE_LINKS, tileStatusLines } from "./cfHome.ts";

const base = {
  finalist: true,
  finalistDone: 0,
  finalistTotal: 3,
  tasksDone: 0,
  tasksTotal: 3,
  hasFolder: true,
  announcementsNew: 2,
  memberCount: 6,
  nextDateShown: "Nov 13" as string | null,
};
const lines = (over: Partial<typeof base> = {}) => tileStatusLines({ ...base, ...over });

test("Tasks, finalist: how many finalist tasks are left and the due date, then All done", () => {
  assert.equal(lines().tasks, "3 to do · due Nov 11");
  assert.equal(lines({ finalistDone: 2 }).tasks, "1 to do · due Nov 11");
  assert.equal(lines({ finalistDone: 3 }).tasks, "All done");
  // Other lists' open items do not count for a finalist (same as the tile's badge).
  assert.equal(lines({ finalistDone: 3, tasksDone: 3, tasksTotal: 7 }).tasks, "All done");
});

test("Tasks, not a finalist: counts every list, no due date, and no line with no tasks", () => {
  const other = { finalist: false, finalistDone: 0, finalistTotal: 0 };
  assert.equal(lines({ ...other, tasksDone: 1, tasksTotal: 4 }).tasks, "3 to do");
  assert.equal(lines({ ...other, tasksDone: 4, tasksTotal: 4 }).tasks, "All done");
  assert.equal(lines({ ...other, tasksDone: 0, tasksTotal: 0 }).tasks, null);
});

test("Files: linked or not", () => {
  assert.equal(lines().files, "Open your Box folder");
  assert.equal(lines({ hasFolder: false }).files, "Not linked yet");
});

test("Announcements: the new count, or Nothing new", () => {
  assert.equal(lines().announcements, "2 new");
  assert.equal(lines({ announcementsNew: 1 }).announcements, "1 new");
  assert.equal(lines({ announcementsNew: 0 }).announcements, "Nothing new");
});

test("Team: the member count", () => {
  assert.equal(lines().team, "6 members");
  assert.equal(lines({ memberCount: 1 }).team, "1 member");
});

test("Timeline: the next date, or no line once the last has passed", () => {
  assert.equal(lines().timeline, "Next: Nov 13");
  assert.equal(lines({ nextDateShown: null }).timeline, null);
});

test("Manage: Links and settings", () => {
  assert.equal(lines().manage, "Links and settings");
});

test("More you can do here: four cards, their links, and never the word winner", () => {
  assert.deepEqual(MORE_LINKS.map((m) => [m.title, m.href]), [
    ["Search the research", "/explore"],
    ["Follow your topic", "/pages"],
    ["Find a service provider", "/collaborate"],
    ["Share your result", "/promote"],
  ]);
  assert.deepEqual(MORE_LINKS.map((m) => m.tint), ["green", "purple", "blue", "amber"]);
  const page = readFileSync(new URL("../../../components/projects/workspace/ColabofestProject.tsx", import.meta.url), "utf8");
  assert.match(page, /More you can do here/);
  assert.ok(page.indexOf(">Latest announcements<") < page.lastIndexOf("More you can do here"));
  for (const src of [page, JSON.stringify(MORE_LINKS), JSON.stringify(lines())]) assert.doesNotMatch(src, /winner/i);
});
