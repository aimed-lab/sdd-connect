"use client";

// The Explore question box for the home header: same box and same behavior as on
// /explore (a question goes to Explore, in the "Everything" scope), without the
// scope picker. The submit button is recolored to read on the green header.

import { useRouter } from "next/navigation";
import QuestionBox from "@/components/explore/QuestionBox";
import { scopeHref, type ScopeKey } from "@/lib/server/explore/exploreLayout";

export default function HomeQuestionBox() {
  const router = useRouter();
  const go = (topic: string, scope: ScopeKey = "all") => router.push(scopeHref(scope, topic));
  return (
    <div className="[&_button[type=submit]]:!bg-[#f3f1ea] [&_button[type=submit]]:!text-[#1A5632] [&_button[type=submit]:hover]:!bg-white [&_input]:!h-14">
      <QuestionBox placeholder="Ask about a disease, drug or target" showScope={false} onSubmit={go} />
    </div>
  );
}
