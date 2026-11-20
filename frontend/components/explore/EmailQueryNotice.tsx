"use client";

// Shown instead of the results page for /explore/<text with an email address>
// (app/explore/[topic]/layout.tsx): an old link, the history, or a typed URL. No search
// runs and nothing is sent. The button only OPENS the assistant: the text is not handed
// over, because it was not typed just now. No follow-the-topic offer, no wiki page.

import Link from "next/link";
import { openAssistant } from "@/lib/server/assistant/assistantBridge";
import { EXPLORE_EMAIL_NOTICE } from "@/lib/server/explore/emailGuard";

export default function EmailQueryNotice() {
  return (
    <main className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-10 pb-16">
      <div className="max-w-xl rounded-2xl border border-outline-variant/40 bg-white p-6 flex flex-col gap-3" role="status">
        <h1 className="font-headline-md text-headline-md text-on-background">{EXPLORE_EMAIL_NOTICE}</h1>
        <p className="font-body-md text-body-md text-secondary">
          This link has an email address in it, so nothing was searched. To add someone to a team or project you lead,
          ask the assistant, for example &ldquo;add name@example.org to the ABCD team&rdquo;.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => openAssistant({ text: "", mode: "open" })}
            className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden>
              auto_awesome
            </span>
            Open the assistant
          </button>
          <Link href="/explore" className="font-label-md text-label-md text-primary hover:underline underline-offset-4">
            Back to Explore
          </Link>
        </div>
      </div>
    </main>
  );
}
