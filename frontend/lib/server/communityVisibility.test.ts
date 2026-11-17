// Run with `npm test`. The one listing rule for communities.

import test from "node:test";
import assert from "node:assert/strict";
import { SIGNED_OUT_MIN_MEMBERS, listedForSignedOut, visibleCommunities } from "./communityVisibility.ts";

const list = [
  { id: "a", member_count: 1 },
  { id: "b", member_count: 3 },
  { id: "c" },
  { id: "d", member_count: 12 },
];

test("signed out: only communities with at least 3 members, order kept", () => {
  assert.equal(SIGNED_OUT_MIN_MEMBERS, 3);
  assert.deepEqual(
    visibleCommunities(list, false).map((c) => c.id),
    ["b", "d"]
  );
});

test("signed in: every community", () => {
  assert.deepEqual(
    visibleCommunities(list, true).map((c) => c.id),
    ["a", "b", "c", "d"]
  );
});

test("a missing count counts as zero", () => {
  assert.equal(listedForSignedOut({}), false);
  assert.equal(listedForSignedOut({ member_count: 2 }), false);
  assert.equal(listedForSignedOut({ member_count: 3 }), true);
});
