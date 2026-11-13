import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectRows,
  communityDescription,
  isColabofestCommunity,
  mergePeople,
  splitNamed,
  projectCode,
  type PersonRow,
} from "./colabofest.ts";

const person = (o: Partial<PersonRow>): PersonRow => ({
  user_id: null,
  email: null,
  name: null,
  institution: null,
  focus: null,
  role: "member",
  ...o,
});

test("only the CollaboFest slug is the invite-only community, with its own description", () => {
  assert.equal(isColabofestCommunity("colabofest-2026"), true);
  assert.equal(isColabofestCommunity("biokdd"), false);
  assert.match(communityDescription("colabofest-2026", "old") ?? "", /Each team works in its own private project/);
  assert.equal(communityDescription("biokdd", "keep me"), "keep me");
});

test("members: community rows and project rows merge by user id, else lowercased email", () => {
  const out = mergePeople([
    person({ user_id: "u1", email: "a@x.org", name: "Ada", role: "admin" }),
    person({ user_id: "u1", email: "a@x.org", institution: "UAB" }),
    person({ email: "Bo@X.org" }),
    person({ email: "bo@x.org", name: "Bo" }),
    person({ user_id: "u2", email: "c@x.org" }),
    person({}),
  ]);
  assert.equal(out.length, 3);
  const ada = out.find((p) => p.user_id === "u1");
  assert.equal(ada?.role, "admin");
  assert.equal(ada?.institution, "UAB");
  assert.equal(out.find((p) => !p.user_id)?.name, "Bo");
});

test("project code comes from the description line", () => {
  assert.equal(projectCode("CollaboFest 2026 · C-108"), "C-108");
  assert.equal(projectCode("nothing here"), null);
  assert.equal(projectCode(null), null);
});

test("projects view: code order, own project first, others have no id, only titles", () => {
  const src = [
    { id: "p8", name: "Eight", description: "CollaboFest 2026 · C-108" },
    { id: "p1", name: "One", description: "CollaboFest 2026 · C-101" },
    { id: "p3", name: "Three", description: "CollaboFest 2026 · C-103" },
    { id: "px", name: "No code", description: null },
  ];
  const rows = buildProjectRows(src, { myProjectIds: ["p3"], openAll: false });
  assert.deepEqual(rows.map((r) => r.name), ["Three", "One", "Eight", "No code"]);
  assert.equal(rows[0].id, "p3");
  assert.equal(rows[0].mine, true);
  assert.equal(rows[1].id, null);
  assert.deepEqual(Object.keys(rows[1]).sort(), ["id", "mine", "name"], "no code, description or flag leaks");
  const staff = buildProjectRows(src, { myProjectIds: [], openAll: true });
  assert.deepEqual(staff.map((r) => r.name), ["One", "Three", "Eight", "No code"]);
  assert.ok(staff.every((r) => r.id));
});

test("members without a real name are counted, never listed, and no email survives", () => {
  const { named, unnamedCount } = splitNamed([
    person({ user_id: "u1", email: "ada@uab.edu", name: "Ada Lovelace" }),
    person({ email: "afr@uab.edu" }),
    person({ user_id: "u2", email: "x@uab.edu", name: "x@uab.edu" }),
    person({ user_id: "u3", email: "z@uab.edu", name: "  " }),
  ]);
  assert.equal(named.length, 1);
  assert.equal(named[0].name, "Ada Lovelace");
  assert.equal(named[0].email, null);
  assert.equal(unnamedCount, 3);
  assert.doesNotMatch(JSON.stringify(named), /@/);
});
