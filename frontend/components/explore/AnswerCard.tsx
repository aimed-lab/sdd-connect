"use client";

// The "AI summary" card at the top of /explore/<topic>: the assistant's short,
// cited answer for the topic (the same /api/assistant call and the same answer
// rendering the side panel uses; signed-in people only), with the quick-facts row
// under it. The quick facts come from the results already on the page and link to
// the matching tab.
//
// The card reports only what the page really has:
//   - `searching` (the page's own search is still running): "Searching ...".
//     The summary is not requested yet; it is requested once the lists are in.
//   - lists in, summary not yet: one ticked line per result tab that has results,
//     with that tab's count, then "Writing the summary".
//   - summary in: the summary and its sources.
//   - the summary call failed: one plain sentence. (/api/assistant is capped at
//     60 seconds on the server, so the wait ends.)
// Signed out, the card stays hidden, as before; the results are untouched.

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Markdown } from "@/components/explore/AssistantChat";
import { parseAssistantReply } from "@/lib/server/assistant/assistantReply";
import { quickFacts, sourcesToCards, stripChoiceText, type ResultCard } from "@/lib/server/assistant/assistantAnswer";
import { resultTabs } from "@/lib/server/explore/exploreLayout";
import type { ExploreSection } from "@/types/explore";

type State =
  | { kind: "loading" }
  | { kind: "ok"; text: string; cards: ResultCard[] }
  | { kind: "failed" };

// A small ring that turns; it stays still when the visitor asks for reduced motion.
function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-outline-variant/60 border-t-primary motion-safe:animate-spin"
    />
  );
}

export default function AnswerCard({
  topic,
  sections,
  searching = false,
  onOpenTab,
}: {
  topic: string;
  sections: ExploreSection[];
  /** True while the page's search is still running: `sections` is not this
   *  topic's results yet, so no counts or facts are shown and the summary is
   *  not requested. */
  searching?: boolean;
  /** Opens the results tab for a quick-fact row's kind. */
  onOpenTab: (kind: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!topic.trim() || authLoading) return;
    // The AI answer needs sign-in (/api/assistant answers 401 otherwise). Signed
    // out, the card stays hidden and the search results below are untouched.
    if (!user) {
      setState({ kind: "failed" });
      return;
    }
    // Wait for the lists, as before: the summary is requested once they are in.
    if (searching) {
      setState({ kind: "loading" });
      return;
    }
    const ctl = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: `What is known about ${topic}?` }], context: { query: topic } }),
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const parsed = parseAssistantReply(await res.json());
        // A reply that is really a proposal (page / community) is not an answer.
        if (!parsed || parsed.action || parsed.community) throw new Error("not an answer");
        const text = stripChoiceText(parsed.reply).trim();
        if (!text) throw new Error("empty");
        setState({ kind: "ok", text, cards: sourcesToCards(parsed.sources) });
      } catch {
        if (!ctl.signal.aborted) setState({ kind: "failed" });
      }
    })();
    return () => ctl.abort();
  }, [topic, user, authLoading, searching]);

  const showCard = !authLoading && !!user && !!topic.trim();
  const facts = searching ? [] : quickFacts(sections, topic);
  // The same labels and counts as the tab row below, for tabs that have results.
  const found = searching ? [] : resultTabs(sections).filter((t) => t.key !== "all" && t.count > 0);

  return (
    <div className="flex flex-col gap-4">
      {showCard && (
        <section aria-label="AI summary" className="rounded-2xl bg-white border border-outline-variant/30 p-6 flex flex-col gap-3">
          <span className="font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary">AI summary</span>

          {/* Always here, so a screen reader hears each change of status. */}
          <div role="status" aria-live="polite" className="font-body-md text-body-md text-on-background">
            {searching ? (
              <p className="flex items-center gap-2">
                <Spinner />
                Searching papers, trials and approvals
              </p>
            ) : state.kind === "loading" ? (
              <div className="flex flex-col gap-2">
                <ul className="flex flex-col gap-1">
                  {found.map((t) => (
                    <li key={t.key} className="flex items-center gap-2">
                      <span aria-hidden="true" className="w-4 shrink-0 text-center font-semibold text-primary">
                        ✓
                      </span>
                      <span>
                        {t.label} <span className="text-secondary">{t.count} found</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="flex items-center gap-2">
                  <Spinner />
                  Writing the summary
                </p>
                <p className="font-body-sm text-body-sm text-secondary">
                  The lists below are ready now. You can start reading while the summary finishes.
                </p>
              </div>
            ) : state.kind === "failed" ? (
              <p>The summary could not be written. The results below are still complete.</p>
            ) : (
              <span className="sr-only">The summary is ready.</span>
            )}
          </div>

          {!searching && state.kind === "ok" && (
            <>
              <div className="font-body-md text-body-md text-on-background leading-relaxed">
                <Markdown text={state.text} maxCite={state.cards.length} />
              </div>
              {state.cards.length > 0 && (
                <ol className="flex flex-col gap-1 pt-1">
                  {state.cards.map((c, i) => (
                    <li key={c.id} className="font-body-sm text-body-sm text-secondary flex gap-2 min-w-0">
                      <span className="shrink-0 font-semibold text-primary">{i + 1}</span>
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary hover:underline underline-offset-2">
                          {c.title}
                        </a>
                      ) : (
                        <span className="truncate">{c.title}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      )}

      {facts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-label="Quick facts">
          {facts.map((f) => (
            <button
              key={f.kind}
              type="button"
              onClick={() => onOpenTab(f.kind)}
              className="text-left rounded-xl bg-white border border-outline-variant/30 hover:border-primary px-4 py-3 transition-colors min-w-0"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-label-md text-label-md text-on-background">{f.label}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface-container-low text-primary font-label-sm text-[11px]">{f.count}</span>
              </span>
              <span className="block mt-1 font-body-sm text-body-sm text-secondary line-clamp-2">{f.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
