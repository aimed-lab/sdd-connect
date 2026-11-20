// Run with `npm test`. What a lead may not do to the team on a program project
// (lib/server/projectWorkspace/memberRules.ts), and that lib/server/projects.ts applies it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { programLeadRefusal, type MemberChange } from "./memberRules.ts";

const PROGRAM = "colabofest_2026";
const refuse = (program: string | null, callerRole: "lead" | "manager", change: MemberChange) =>
  programLeadRefusal({ program, callerRole, change });

// ── 1. add ───────────────────────────────────────────────────────────────────

test("add, program project: a lead adds members only", () => {
  assert.equal(refuse(PROGRAM, "lead", { kind: "add", role: "member" }), null);
  assert.equal(
    refuse(PROGRAM, "lead", { kind: "add", role: "manager" }),
    "On CollaboFest projects, leads can add members only. The SPARC team manages roles."
  );
  assert.match(refuse(PROGRAM, "lead", { kind: "add", role: "lead" }) ?? "", /leads can add members only/);
});

test("add, ordinary project: a lead may add any role, as today", () => {
  for (const role of ["member", "manager", "lead"]) assert.equal(refuse(null, "lead", { kind: "add", role }), null, role);
});

// ── 2. remove ────────────────────────────────────────────────────────────────

test("remove, program project: a lead removes plain members only", () => {
  assert.equal(refuse(PROGRAM, "lead", { kind: "remove", targetRole: "member" }), null);
  assert.equal(
    refuse(PROGRAM, "lead", { kind: "remove", targetRole: "manager" }),
    "On CollaboFest projects, leads can remove members only. The SPARC team manages roles."
  );
  assert.match(refuse(PROGRAM, "lead", { kind: "remove", targetRole: "lead" }) ?? "", /leads can remove members only/);
});

test("remove, ordinary project: nothing extra (projects.ts still refuses removing a lead)", () => {
  for (const targetRole of ["member", "manager", "lead"]) {
    assert.equal(refuse(null, "lead", { kind: "remove", targetRole }), null, targetRole);
  }
});

// ── 3. promote and set role ──────────────────────────────────────────────────

test("promote and set role, program project: refused for a lead", () => {
  assert.equal(refuse(PROGRAM, "lead", { kind: "promote" }), "On CollaboFest projects, the SPARC team manages roles.");
  assert.equal(refuse(PROGRAM, "lead", { kind: "set_role" }), "On CollaboFest projects, the SPARC team manages roles.");
});

test("promote and set role, ordinary project: allowed for a lead, as today", () => {
  assert.equal(refuse(null, "lead", { kind: "promote" }), null);
  assert.equal(refuse(null, "lead", { kind: "set_role" }), null);
});

// ── 4. managers are unaffected ───────────────────────────────────────────────

test("a manager: never refused here, on either kind of project (its own limits stay in projects.ts)", () => {
  const changes: MemberChange[] = [
    { kind: "add", role: "member" },
    { kind: "add", role: "manager" },
    { kind: "remove", targetRole: "member" },
    { kind: "remove", targetRole: "manager" },
    { kind: "promote" },
    { kind: "set_role" },
  ];
  for (const program of [PROGRAM, null]) {
    for (const change of changes) assert.equal(refuse(program, "manager", change), null, `${program} ${JSON.stringify(change)}`);
  }
});

test("another program value: same rules, generic wording", () => {
  assert.equal(refuse("other_program", "lead", { kind: "promote" }), "On program projects, the SPARC team manages roles.");
  assert.equal(refuse("", "lead", { kind: "promote" }), null);
  assert.equal(refuse(undefined as unknown as null, "lead", { kind: "promote" }), null);
});

// ── projects.ts applies it in all four places ────────────────────────────────

test("lib/server/projects.ts: each of the four functions checks the rule with the project's program", () => {
  const src = readFileSync(new URL("../projects.ts", import.meta.url), "utf8");
  const body = (name: string) => {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next < 0 ? undefined : next);
  };
  const expect: [string, string][] = [
    ["addProjectMember", `kind: "add"`],
    ["removeProjectMember", `kind: "remove"`],
    ["promoteProjectMember", `kind: "promote"`],
    ["setMemberRole", `kind: "set_role"`],
  ];
  for (const [fn, kind] of expect) {
    const b = body(fn);
    assert.ok(b.includes("programLeadRefusal({") && b.includes("program: gate.program") && b.includes(kind), fn);
  }
  assert.match(src, /\.select\("lead_id, deadline, program"\)/);
});
