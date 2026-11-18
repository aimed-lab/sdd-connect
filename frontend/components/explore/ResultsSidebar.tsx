"use client";

// The right-hand column of /explore/<topic> (below the results on a phone):
// follow this topic (starts the assistant's usual wiki-page save flow, with its
// confirm step), ask a follow-up (two suggestions that open the assistant), and
// people on this (the best matching community, or a short note when none
// matches; hidden only when the check itself failed), and companies that might
// help (up to 3 from the provider directory; never hidden, says so when none
// match; first in the column when the question asks for companies).

import Link from "next/link";
import { useEffect, useState } from "react";
import { joinCommunityAction } from "@/app/communities/actions";
import { useAuth } from "@/context/AuthContext";
import { followUpsFor } from "@/lib/server/assistant/assistantAnswer";
import { openAssistant, saveAsLivingPageMessage } from "@/lib/server/assistant/assistantBridge";
import {
  JOIN_REVIEW_NOTE,
  matchAction,
  matchReason,
  pickPeopleMatch,
  SIGNED_OUT_MATCH_NOTE,
  type CommunityMatch,
} from "@/lib/server/assistant/communityMatch";
import { nextStepsFor } from "@/lib/server/explore/nextSteps";
import { asksForProviders, providerSearchTerms } from "@/lib/server/providers/questionTerms";
import type { ExploreScope, ExploreSection } from "@/types/explore";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-outline-variant/30 p-5 flex flex-col gap-3">
      <h2 className="font-title text-[18px] leading-tight font-medium text-on-background">{title}</h2>
      {children}
    </section>
  );
}

function PeopleOnThis({ topic }: { topic: string }) {
  const { user } = useAuth();
  const [match, setMatch] = useState<CommunityMatch | null>(null);
  const [none, setNone] = useState(false);
  const [done, setDone] = useState<"active" | "pending" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMatch(null);
    setNone(false);
    setDone(null);
    (async () => {
      try {
        const res = await fetch(`/api/communities/match?q=${encodeURIComponent(topic)}`, { cache: "no-store" });
        const json = await res.json();
        const valid: CommunityMatch[] = (Array.isArray(json?.matches) ? json.matches : []).filter(
          (m: unknown): m is CommunityMatch =>
            !!m && typeof m === "object" && typeof (m as CommunityMatch).id === "string" && typeof (m as CommunityMatch).slug === "string" && typeof (m as CommunityMatch).name === "string"
        );
        // Prefer a community the viewer is not in yet.
        const best = pickPeopleMatch(valid);
        if (cancelled) return;
        if (best) setMatch(best);
        else if (res.ok) setNone(true);
      } catch {
        /* the check failed: the card stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [topic]);

  if (!match) {
    if (!none) return null;
    return (
      <Card title="People on this">
        <p className="font-body-sm text-body-sm text-secondary break-words">
          No {user ? "" : "listed "}community matches &ldquo;{topic}&rdquo; yet. Try a shorter topic, or{" "}
          <Link href="/communities" className="text-primary hover:underline underline-offset-4">
            browse all communities
          </Link>
          .
        </p>
        {!user && (
          <Link href={loginHref(topic)} className="font-label-md text-label-md text-primary hover:underline underline-offset-4">
            {SIGNED_OUT_MATCH_NOTE}
          </Link>
        )}
      </Card>
    );
  }
  const act = matchAction({ isOpen: match.isOpen, state: user ? match.state : "signed_out" });

  return (
    <Card title="People on this">
      <div className="flex flex-col gap-1">
        <Link href={`/communities/${match.slug}`} className="font-label-lg text-label-lg text-on-background hover:text-primary break-words">
          {match.name}
        </Link>
        <p className="font-body-sm text-body-sm text-secondary">
          {match.memberCount} {match.memberCount === 1 ? "member" : "members"}
          {match.runBy ? ` · Run by ${match.runBy}` : ""}
        </p>
        {match.why.length > 0 && <p className="font-body-sm text-body-sm text-primary">{match.reason || matchReason(match.why)}</p>}
        {!match.isOpen && !(user && match.state === "active") && (
          <p className="font-body-sm text-body-sm text-secondary">{JOIN_REVIEW_NOTE}</p>
        )}
      </div>
      {done ? (
        <p className="font-label-md text-label-md text-primary">{done === "active" ? "You're in" : "Request sent"}</p>
      ) : act.kind === "join" || act.kind === "request" ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await joinCommunityAction(match.id, match.isOpen, match.slug);
            setBusy(false);
            if (res.ok) setDone(match.isOpen ? "active" : "pending");
            else setError(res.error);
          }}
          className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? "…" : act.label}
        </button>
      ) : user && match.state === "active" ? (
        <p className="font-label-md text-label-md text-secondary">
          You&apos;re a member ·{" "}
          <Link href={`/communities/${match.slug}`} className="text-primary hover:underline underline-offset-4">
            Open
          </Link>
        </p>
      ) : act.kind === "signin" ? (
        <>
          <Link href={loginHref(topic)} className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md">
            {act.label}
          </Link>
          <Link href={loginHref(topic)} className="font-body-sm text-body-sm text-primary hover:underline underline-offset-4">
            {SIGNED_OUT_MATCH_NOTE}
          </Link>
        </>
      ) : (
        <p className="font-label-md text-label-md text-secondary">{act.label}</p>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

type ProviderHit = { slug: string; name: string; description: string; services: string[]; category_label: string };

/** One line on what the company does: the first sentence of its own
 *  description, else its first services, else its category. */
function whatTheyDo(p: ProviderHit): string {
  const sentence = (p.description || "").split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (sentence) return sentence.length > 140 ? `${sentence.slice(0, 139).trimEnd()}…` : sentence;
  if (p.services.length > 0) return p.services.slice(0, 3).join(", ");
  return p.category_label;
}

function parseHits(json: unknown): ProviderHit[] {
  const list = (json as { providers?: unknown })?.providers;
  return (Array.isArray(list) ? list : [])
    .filter(
      (p: unknown): p is ProviderHit =>
        !!p && typeof p === "object" && typeof (p as ProviderHit).slug === "string" && typeof (p as ProviderHit).name === "string"
    )
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      description: typeof p.description === "string" ? p.description : "",
      services: Array.isArray(p.services) ? p.services.filter((s): s is string => typeof s === "string") : [],
      category_label: typeof p.category_label === "string" ? p.category_label : "",
    }));
}

// Searches each term on its own (never the whole question; see
// lib/server/providers/questionTerms.ts) and shows up to 3 companies, earlier
// terms first, each company once.
function CompaniesThatMightHelp({ terms }: { terms: string[] }) {
  const [hits, setHits] = useState<ProviderHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = terms.join("\n");

  useEffect(() => {
    let cancelled = false;
    setHits(null);
    setFailed(false);
    const list = key ? key.split("\n") : [];
    if (list.length === 0) {
      setHits([]);
      return;
    }
    (async () => {
      try {
        const results = await Promise.all(
          list.map(async (term) => {
            const res = await fetch(`/api/providers?q=${encodeURIComponent(term)}&limit=3`, { cache: "no-store" });
            if (!res.ok) throw new Error(`providers ${res.status}`);
            return parseHits(await res.json());
          })
        );
        if (cancelled) return;
        const merged: ProviderHit[] = [];
        for (const p of results.flat()) {
          if (merged.length < 3 && !merged.some((m) => m.slug === p.slug)) merged.push(p);
        }
        setHits(merged);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const browse = (
    <Link href="/collaborate/providers" className="text-primary hover:underline underline-offset-4">
      browse the directory
    </Link>
  );

  return (
    <Card title="Companies that might help">
      <p className="font-body-sm text-body-sm text-secondary -mt-2">
        Matches come from the companies&apos; own descriptions in our directory.
      </p>
      {failed ? (
        <p className="font-body-sm text-body-sm text-secondary break-words">
          Couldn&apos;t check the directory just now. You can {browse}.
        </p>
      ) : hits === null ? (
        <p className="font-body-sm text-body-sm text-secondary">Checking the directory…</p>
      ) : hits.length === 0 ? (
        <p className="font-body-sm text-body-sm text-secondary break-words">
          No matching companies in our directory yet. You can {browse}.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {hits.map((p) => (
            <li key={p.slug} className="flex flex-col gap-0.5 min-w-0">
              <Link
                href={`/collaborate/providers/${encodeURIComponent(p.slug)}`}
                className="font-label-lg text-label-lg text-on-background hover:text-primary break-words"
              >
                {p.name}
              </Link>
              <p className="font-body-sm text-body-sm text-secondary break-words">{whatTheyDo(p)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const FOLLOW_POINTS = [
  "Starts with the results on this page",
  "Private to you until you share it",
  "You can add your own notes",
];

const loginHref = (topic: string) => `/login?callbackUrl=${encodeURIComponent(`/explore/${encodeURIComponent(topic)}`)}`;

// Signed out: following and follow-up questions need the assistant, which needs
// an account, so say so before anyone clicks, and offer next steps built only
// from the results already on the page.
function SignedOutSidebar({ topic, sections, scope }: { topic: string; sections: ExploreSection[]; scope?: ExploreScope }) {
  const steps = nextStepsFor(sections, topic);
  const companies = <CompaniesThatMightHelp terms={providerSearchTerms(scope, topic)} />;
  const companiesFirst = asksForProviders(topic);
  return (
    <aside className="flex flex-col gap-4 min-w-0" aria-label="Next steps">
      {companiesFirst && companies}
      <Card title="Next steps">
        <ul className="flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.key}>
              <Link href={step.href} className="font-body-sm text-body-sm text-primary hover:underline underline-offset-4 break-words">
                {step.label} →
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Follow or ask a follow-up">
        <p className="font-body-sm text-body-sm text-secondary break-words">
          Following {topic} and asking the research assistant need an account. Everything else on this page works
          without one.
        </p>
        <Link href={loginHref(topic)} className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md">
          Sign in to use the assistant
        </Link>
      </Card>

      <PeopleOnThis topic={topic} />
      {!companiesFirst && companies}
    </aside>
  );
}

export default function ResultsSidebar({
  topic,
  sections,
  scope,
}: {
  topic: string;
  sections: ExploreSection[];
  scope?: ExploreScope;
}) {
  const { user, loading } = useAuth();
  const questions = followUpsFor(sections, topic).slice(0, 2);

  if (!loading && !user) return <SignedOutSidebar topic={topic} sections={sections} scope={scope} />;

  // A question asking for companies gets the companies card first.
  const companies = <CompaniesThatMightHelp terms={providerSearchTerms(scope, topic)} />;
  const companiesFirst = asksForProviders(topic);

  return (
    <aside className="flex flex-col gap-4 min-w-0" aria-label="Next steps">
      {companiesFirst && companies}
      <Card title="Follow this topic">
        <p className="font-body-sm text-body-sm text-secondary break-words">
          Get your own page on {topic}. New papers, trials and approvals are added to it every day.
        </p>
        <ul className="flex flex-col gap-1 font-body-sm text-body-sm text-on-background">
          {FOLLOW_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <span aria-hidden="true" className="w-4 shrink-0 text-center font-semibold text-primary">
                ✓
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => openAssistant({ text: saveAsLivingPageMessage(topic), mode: "send", stay: true })}
          className="btn-primary self-start px-4 py-2 rounded-lg font-label-md text-label-md"
        >
          Follow this topic
        </button>
      </Card>

      <Card title="Ask a follow-up">
        <div className="flex flex-col gap-2">
          {questions.map((q) => (
            <button
              key={q.text}
              type="button"
              onClick={() => openAssistant({ text: q.text, mode: "send" })}
              className="text-left px-3.5 py-2.5 rounded-xl border border-outline-variant/30 hover:border-primary hover:text-primary font-body-sm text-body-sm text-on-background transition-colors"
            >
              {q.text}
            </button>
          ))}
        </div>
      </Card>

      <PeopleOnThis topic={topic} />
      {!companiesFirst && companies}
    </aside>
  );
}
