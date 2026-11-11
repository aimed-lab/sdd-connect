"use client";

// The Explore question box for the home header: same box and same behavior as on
// /explore (a question goes to Explore, in the "Everything" scope), without the
// scope picker. The submit button is recolored to read on the green header.
// The "Try" example buttons are QuestionBox's own (same click behavior as on
// /explore); here they are only recolored for the green header and made 44px tall.

import { useRouter } from "next/navigation";
import QuestionBox from "@/components/explore/QuestionBox";
import { scopeHref, type ScopeKey } from "@/lib/server/explore/exploreLayout";

const EXAMPLES = ["KRAS in pancreatic cancer", "Open trials for Alzheimer's", "PHGDH inhibitors"];

// Recolors for the green header. "button[type=button]" matches only the example
// buttons; "span.text-secondary" matches only the word "Try".
const SUBMIT_ON_GREEN =
  "[&_button[type=submit]]:!bg-[#f3f1ea] [&_button[type=submit]]:!text-[#1A5632] [&_button[type=submit]:hover]:!bg-white [&_input]:!h-14";
const EXAMPLES_ON_GREEN =
  "[&_span.text-secondary]:!text-white/85 " +
  "[&_button[type=button]]:min-h-11 [&_button[type=button]]:!bg-transparent [&_button[type=button]]:!text-white [&_button[type=button]]:!border-white/70 " +
  "[&_button[type=button]:hover]:!bg-white/10 [&_button[type=button]:hover]:!text-white [&_button[type=button]:hover]:!border-white " +
  "[&_button[type=button]:focus-visible]:outline-none [&_button[type=button]:focus-visible]:ring-2 [&_button[type=button]:focus-visible]:ring-white/70";

export default function HomeQuestionBox() {
  const router = useRouter();
  const go = (topic: string, scope: ScopeKey = "all") => router.push(scopeHref(scope, topic));
  return (
    <div className={`${SUBMIT_ON_GREEN} ${EXAMPLES_ON_GREEN}`}>
      <QuestionBox placeholder="Ask about a disease, drug or target" examples={EXAMPLES} showScope={false} onSubmit={go} />
    </div>
  );
}
