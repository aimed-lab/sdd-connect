"use client";

// The one big question box on Explore, with a scope picker ("Everything" by
// default, or Papers, Preprints, Clinical trials, ...) and optional example
// topic chips. Submitting calls onSubmit(topic, scope); the pages send that to
// scopeHref() (lib/server/explore/exploreLayout.ts).
//
// TEXT WITH AN EMAIL ADDRESS IS NEVER A SEARCH: typed and submitted here, it is handed
// to the assistant panel as the person's own typed message (handOffTypedSearch,
// lib/server/assistant/assistantBridge.ts), so "add x@y.org to a team" runs the
// add-member flow there, and onSubmit is not called: no /explore/<text> URL, no search.
// Only the typed box does this, never the example chips. On a page without the panel
// (the home page) the text waits briefly and the page moves to /explore, where the
// panel picks it up.

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SCOPES, type ScopeKey } from "@/lib/server/explore/exploreLayout";
import { handOffTypedSearch, shouldHandOffSearch } from "@/lib/server/assistant/assistantBridge";
import { assistantAvailableOn } from "@/lib/server/assistant/assistantReply";

export default function QuestionBox({
  initial = "",
  initialScope = "all",
  placeholder,
  examples,
  showScope = true,
  onSubmit,
}: {
  initial?: string;
  initialScope?: ScopeKey;
  placeholder: string;
  /** Topic chips under the box; clicking one searches it (in the chosen scope). */
  examples?: string[];
  showScope?: boolean;
  onSubmit: (topic: string, scope: ScopeKey) => void;
}) {
  const [value, setValue] = useState(initial);
  const [scope, setScope] = useState<ScopeKey>(initialScope);
  const [handedOff, setHandedOff] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  return (
    <section className="max-w-3xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          if (!q) return;
          if (shouldHandOffSearch(q)) {
            const panelHere = assistantAvailableOn(pathname);
            handOffTypedSearch(q, panelHere);
            setValue("");
            setHandedOff(true);
            if (!panelHere) router.push("/explore");
            return;
          }
          setHandedOff(false);
          onSubmit(q, scope);
        }}
        className="relative"
      >
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (handedOff) setHandedOff(false);
          }}
          type="text"
          aria-label="Your question"
          placeholder={placeholder}
          className="w-full h-16 px-6 pr-16 sm:pr-48 bg-white border border-outline-variant/40 rounded-[16px] focus:ring-2 focus:ring-primary focus:border-primary text-body-lg font-body-lg text-on-background caret-on-background placeholder:text-secondary/50 transition-all shadow-[0_1px_2px_rgba(25,28,30,0.04)]"
        />
        <button
          type="submit"
          aria-label="Ask a question"
          className="absolute right-3 top-3 bottom-3 btn-primary px-5 rounded-xl flex items-center justify-center gap-2 font-label-md text-label-md"
        >
          <span className="material-symbols-outlined">search</span>
          <span className="hidden sm:inline">Ask a question</span>
        </button>
      </form>
      {handedOff && (
        <p className="mt-2 font-body-sm text-body-sm text-secondary" role="status">
          Explore doesn&rsquo;t search email addresses, so the assistant has it. Check the panel on the right.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {showScope && (
          <label className="flex items-center gap-2 font-label-md text-label-md text-secondary">
            Search in
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeKey)}
              className="bg-white border border-outline-variant/40 rounded-lg px-3 py-1.5 font-label-md text-label-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {SCOPES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {examples && examples.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-label-sm text-label-sm text-secondary">Try</span>
            {examples.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onSubmit(t, scope)}
                className="px-3.5 py-1.5 rounded-full bg-white border border-outline-variant/40 font-label-md text-label-md text-on-background hover:border-primary hover:text-primary transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
