// Run with `npm test`. Which member controls the CollaboFest Team view shows
// (components/projects/workspace/ProjectTeamView.tsx).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVITED_LABEL, NO_EMAIL_NOTE, canManageMembers, teamControls } from "./teamControls.ts";

const forRole = (role: string | null) => teamControls(canManageMembers(role));

test("canManageMembers: leads and managers, nobody else", () => {
  assert.equal(canManageMembers("lead"), true);
  assert.equal(canManageMembers("manager"), true);
  assert.equal(canManageMembers("member"), false);
  assert.equal(canManageMembers(null), false);
  assert.equal(canManageMembers(undefined), false);
  assert.equal(canManageMembers("admin"), false);
});

test("a lead: adds members, removes plain members only", () => {
  const c = forRole("lead");
  assert.equal(c.canAdd, true);
  assert.equal(c.canRemove("member"), true);
  assert.equal(c.canRemove("manager"), false);
  assert.equal(c.canRemove("lead"), false);
});

test("a manager (SPARC team): the same as a lead", () => {
  const c = forRole("manager");
  assert.equal(c.canAdd, true);
  assert.equal(c.canRemove("member"), true);
  assert.equal(c.canRemove("manager"), false);
  assert.equal(c.canRemove("lead"), false);
});

test("a plain member or a non-member: no controls", () => {
  for (const role of ["member", null]) {
    const c = forRole(role);
    assert.equal(c.canAdd, false, String(role));
    for (const r of ["member", "manager", "lead"]) assert.equal(c.canRemove(r), false, `${role} -> ${r}`);
  }
});

test("the texts", () => {
  assert.equal(INVITED_LABEL, "Invited, not signed in yet");
  assert.equal(
    NO_EMAIL_NOTE,
    "No email is sent. Ask them to sign in at connect.smartdrugdiscovery.org with this email to see the project."
  );
});

// The Team view itself: it only ever adds a plain member, and has no way to promote,
// change a role or step down (those controls must not appear for a CollaboFest lead).
test("ProjectTeamView: adds as 'member' only, no role-changing actions", () => {
  const src = readFileSync(new URL("../../../components/projects/workspace/ProjectTeamView.tsx", import.meta.url), "utf8");
  assert.match(src, /addMemberAction\(projectId, email, "member"\)/);
  assert.doesNotMatch(src, /addMemberAction\([^)]*"manager"/);
  for (const name of ["promoteMemberAction", "setMemberRoleAction", "stepDownAction"]) {
    assert.ok(!src.includes(name), name);
  }
  assert.match(src, /controls\.canAdd/);
  assert.match(src, /controls\.canRemove\(m\.role\)/);
  assert.match(src, /INVITED_LABEL/);
  assert.match(src, /NO_EMAIL_NOTE/);
});

test("the project page passes canManageMembers(role) into ProjectTeamView", () => {
  const src = readFileSync(new URL("../../../app/projects/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(src, /<ProjectTeamView[^>]*canManageMembers=\{canManageMembers\(role\)\}/);
});
