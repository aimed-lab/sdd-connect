// Run with `npm test`. The signed-out "Next steps" card on /explore/<topic>.

import test from "node:test";
import assert from "node:assert/strict";
import { nextStepsFor } from "./nextSteps.ts";
import type { ExploreSection } from "@/types/explore";

const section = (kind: string, n: number) =>
  ({ kind, title: kind, items: Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, title: "x" })) }) as unknown as ExploreSection;

test("links the kinds that have results, with their real counts", () => {
  const steps = nextStepsFor([section("paper", 10), section("trial", 1), section("grant", 0)], "KRAS in pancreatic cancer");
  assert.deepEqual(
    steps.map((s) => [s.label, s.href]),
    [
      ["See 10 papers", "/explore/KRAS%20in%20pancreatic%20cancer?category=paper"],
      ["See 1 trial", "/explore/KRAS%20in%20pancreatic%20cancer?category=trial"],
      ["Browse research communities", "/communities"],
      ["Find a service provider", "/collaborate/providers"],
    ]
  );
});

test("at most three result links", () => {
  const steps = nextStepsFor(["paper", "preprint", "trial", "approval", "grant"].map((k) => section(k, 2)), "PHGDH");
  assert.equal(steps.filter((s) => s.href.startsWith("/explore/")).length, 3);
});

test("no results: only the fixed links", () => {
  assert.deepEqual(
    nextStepsFor([], "PHGDH").map((s) => s.key),
    ["communities", "providers"]
  );
  assert.deepEqual(
    nextStepsFor(null, "  ").map((s) => s.key),
    ["communities", "providers"]
  );
});
