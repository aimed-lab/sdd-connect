// lib/server/explore/nextSteps.ts — the "Next steps" card a signed-out visitor
// sees beside /explore/<topic> results, in place of the assistant. Built only
// from the results already on the page and fixed site links: no LLM call, no
// provider search, nothing per visitor.
//
// No runtime imports beyond other pure helpers, so `npm test` covers it.

import type { ExploreSection } from "@/types/explore";
import { countChips } from "../assistant/assistantAnswer.ts";

export type NextStep = { key: string; label: string; href: string };

/** Up to three "See 12 trials" links (kinds with results, in countChips' order),
 *  then communities and service providers. */
export function nextStepsFor(sections: ExploreSection[] | null | undefined, topic: string): NextStep[] {
  const t = topic.trim();
  const results: NextStep[] = t
    ? countChips(sections)
        .slice(0, 3)
        .map((c) => ({
          key: c.kind,
          label: `See ${c.text}`,
          href: `/explore/${encodeURIComponent(t)}?category=${encodeURIComponent(c.kind)}`,
        }))
    : [];
  return [
    ...results,
    { key: "communities", label: "Browse research communities", href: "/communities" },
    { key: "providers", label: "Find a service provider", href: "/collaborate/providers" },
  ];
}
