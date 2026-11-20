"use client";

// The Explore assistant's confirm card for "add <email> to <team or project>"
// (lib/server/assistant/actionIntent.ts). Nothing changes until Confirm is pressed.
//
// 1. On mount it asks the server which of the person's OWN teams and projects the name
//    means, among those they may add members to (resolveAddMemberTargetAction, read
//    with their session). The model never picks one.
// 2. One match: shown. Several: a picker, nothing preselected. None: a plain message
//    and links to My teams / My projects.
// 3. Confirm calls the existing action for that target (addCommunityMemberByEmailAction
//    for a team, addMemberAction for a project) with the chosen id. Those check
//    permissions again, so a stale or edited card can't get past them.

import { useEffect, useState } from "react";
import Link from "next/link";
import { addCommunityMemberByEmailAction } from "@/app/communities/actions";
import { addMemberAction } from "@/app/projects/[id]/actions";
import { resolveAddMemberTargetAction } from "@/app/explore/assistantActions";
import {
  ADD_MEMBER_NOTE,
  acceptExtractedIntent,
  type AddMemberIntent,
  type AddMemberOutcome,
} from "@/lib/server/assistant/actionIntent";
import type { TargetCandidate } from "@/lib/server/assistant/actionTargets";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; candidates: TargetCandidate[] }
  | { kind: "none"; message: string }
  | { kind: "error"; message: string }
  | { kind: "working"; candidates: TargetCandidate[] }
  | { kind: "done"; target: TargetCandidate; already: boolean }
  | { kind: "refused"; candidates: TargetCandidate[]; message: string }
  | { kind: "cancelled" };

/** For a message the strict parser missed: ask the server's small extraction route.
 *  Checked again here: the email and the name must be in the message, or null.
 *  Null on any failure, so the message just carries on as a question. */
export async function extractAddMemberIntent(message: string): Promise<AddMemberIntent | null> {
  try {
    const res = await fetch("/api/assistant/extract-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { intent?: AddMemberIntent | null };
    const i = data?.intent;
    if (!i) return null;
    return acceptExtractedIntent({ email: i.email, target_name: i.targetName, target_type: i.targetType }, message);
  } catch {
    return null;
  }
}

const CARD = "rounded-xl border border-outline-variant/40 bg-white p-4 flex flex-col gap-3";
const EYEBROW = "font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary";

function typeLabel(c: TargetCandidate): string {
  const kind = c.type === "team" ? "Team" : "Project";
  return c.code && !c.name.includes(c.code) ? `${kind} · ${c.code}` : kind;
}

function members(n: number): string {
  return `${n} ${n === 1 ? "member" : "members"}`;
}

export function AddMemberCard({
  intent,
  onOutcome,
}: {
  intent: AddMemberIntent;
  /** The lookup's result, so the line above the card can say the right thing (the
   *  confirm line only when there is a Confirm button). */
  onOutcome?: (outcome: AddMemberOutcome) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void resolveAddMemberTargetAction({ targetName: intent.targetName, targetType: intent.targetType }).then((res) => {
      if (!live) return;
      if (!res.ok) {
        onOutcome?.({ kind: "error", message: res.error });
        return setPhase({ kind: "error", message: res.error });
      }
      if (res.candidates.length === 0) {
        onOutcome?.({ kind: "none", message: res.message ?? "I couldn't find that team or project." });
        return setPhase({ kind: "none", message: res.message ?? "" });
      }
      onOutcome?.({ kind: "candidates", count: res.candidates.length });
      // One match is shown as the choice; several are a picker with nothing chosen.
      if (res.candidates.length === 1) setChosen(`${res.candidates[0].type}:${res.candidates[0].id}`);
      setPhase({ kind: "ready", candidates: res.candidates });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.targetName, intent.targetType]);

  const keyOf = (c: TargetCandidate) => `${c.type}:${c.id}`;

  const confirm = async (candidates: TargetCandidate[]) => {
    const target = candidates.find((c) => keyOf(c) === chosen);
    if (!target) return;
    setPhase({ kind: "working", candidates });
    const res =
      target.type === "team"
        ? await addCommunityMemberByEmailAction(target.id, target.slug ?? "", intent.email)
        : await addMemberAction(target.id, intent.email, "member");
    if (res.ok) return setPhase({ kind: "done", target, already: false });
    if (/already/i.test(res.error)) return setPhase({ kind: "done", target, already: true });
    setPhase({ kind: "refused", candidates, message: res.error });
  };

  // While looking, the line above the card says so.
  if (phase.kind === "loading") return null;

  if (phase.kind === "error" || phase.kind === "none") {
    // The reason is the line above the card (onOutcome); no Confirm here.
    return (
      <div className={CARD}>
        <div className="flex flex-wrap gap-4 font-label-md text-label-md">
          <Link href="/teams" className="text-primary hover:underline underline-offset-4">
            My teams
          </Link>
          <Link href="/projects" className="text-primary hover:underline underline-offset-4">
            My projects
          </Link>
        </div>
      </div>
    );
  }

  if (phase.kind === "cancelled") {
    return (
      <div className={CARD} role="status">
        <p className="font-body-sm text-body-sm text-secondary">Cancelled. Nothing was changed.</p>
      </div>
    );
  }

  if (phase.kind === "done") {
    const t = phase.target;
    return (
      <div className="rounded-xl border border-primary bg-white p-4 flex flex-col gap-2" role="status">
        <p className="font-body-md text-body-md text-on-background">
          {phase.already ? (
            <>
              <span className="font-semibold">{intent.email}</span> is already a member of {t.name}.
            </>
          ) : (
            <>
              Added <span className="font-semibold">{intent.email}</span> to {t.name}. No email was sent, so let them know.
            </>
          )}
        </p>
        <Link href={t.href} className="self-start font-label-md text-label-md text-primary hover:underline underline-offset-4">
          Open the {t.type}
        </Link>
      </div>
    );
  }

  const { candidates } = phase;
  const working = phase.kind === "working";
  const several = candidates.length > 1;

  return (
    <div className={CARD}>
      <span className={EYEBROW}>Add a member</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-label-sm text-label-sm text-secondary">Email</span>
        <span className="font-body-md text-body-md text-on-background font-semibold break-all">{intent.email}</span>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={working}>
        <legend className="font-label-sm text-label-sm text-secondary mb-1">
          {several ? `${candidates.length} of your teams and projects match "${intent.targetName}". Pick one:` : "Add to"}
        </legend>
        {candidates.map((c) => {
          const k = keyOf(c);
          const body = (
            <span className="min-w-0 flex flex-col">
              <span className="font-body-md text-body-md text-on-background font-semibold break-words">{c.name}</span>
              <span className="font-body-sm text-body-sm text-secondary">
                {typeLabel(c)} · {members(c.memberCount)} ·{" "}
                <Link href={c.href} className="text-primary hover:underline underline-offset-4" target="_blank">
                  Open
                </Link>
              </span>
            </span>
          );
          return several ? (
            <label
              key={k}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer ${chosen === k ? "border-primary" : "border-outline-variant/40"}`}
            >
              <input
                type="radio"
                name={`add-member-target-${intent.email}-${intent.targetName}`}
                checked={chosen === k}
                onChange={() => setChosen(k)}
                className="mt-1 accent-[#1A5632]"
              />
              {body}
            </label>
          ) : (
            <div key={k} className="rounded-lg border border-outline-variant/40 px-3 py-2">
              {body}
            </div>
          );
        })}
      </fieldset>

      <p className="font-body-sm text-body-sm text-secondary">{ADD_MEMBER_NOTE}</p>

      {phase.kind === "refused" && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {phase.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void confirm(candidates)}
          disabled={working || !chosen}
          className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {working ? "Adding…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setPhase({ kind: "cancelled" })}
          disabled={working}
          className="font-label-md text-label-md text-secondary hover:text-on-background disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
