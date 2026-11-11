"use client";

// The "Progress" card on a team page: short updates from members, each tagged
// Done, Working on or Stuck. Any member posts; the author or a lead deletes.
// An update is a tagged Team news row (lib/server/teams/teamRules.ts explains);
// tagged rows are shown here and not under Team news.

import { useState } from "react";
import { deleteProgressAction, postProgressAction } from "@/app/teams/actions";
import MoreMenu from "@/components/MoreMenu";
import { initials, shortDate } from "@/lib/server/communityHome/communityHome";
import {
  DEFAULT_PROGRESS_TAG,
  PROGRESS_TAGS,
  PROGRESS_TAG_LABEL,
  PROGRESS_TEXT_MAX,
  canDeleteProgress,
  shownProgress,
  type ProgressTag,
} from "@/lib/server/teams/teamRules";
import { Card, Err, ROW, useDo } from "./TeamShelves";

export type ProgressItem = { id: string; author_id: string; title: string; created_at: string; tag: ProgressTag };

// Done green, Working on neutral, Stuck amber.
const CHIP: Record<ProgressTag, string> = {
  done: "bg-[#e4efe7] text-[#1A5632]",
  working: "bg-[#f3f1ea] text-on-background",
  stuck: "bg-[#f8ecd6] text-[#6b3900]",
};

export default function ProgressCard({
  teamId,
  slug,
  items,
  names,
  viewerId,
  isLead,
}: {
  teamId: string;
  slug: string;
  /** Newest first. */
  items: ProgressItem[];
  /** user id -> display name, for the people on the team now. */
  names: Record<string, string>;
  viewerId: string;
  isLead: boolean;
}) {
  const { busy, error, run } = useDo();
  const [text, setText] = useState("");
  const [tag, setTag] = useState<ProgressTag>(DEFAULT_PROGRESS_TAG);
  const [expanded, setExpanded] = useState(false);
  const { shown, older } = shownProgress(items, expanded);
  const posting = busy === "post";

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || posting) return;
    await run("post", async () => {
      const res = await postProgressAction(teamId, slug, { text, tag });
      if (res.ok) {
        setText("");
        setTag(DEFAULT_PROGRESS_TAG);
      }
      return res;
    });
  };

  return (
    <Card title="Progress">
      <p className="-mt-2 font-body-md text-[14px] leading-[1.5] text-secondary">Short updates so everyone knows where things stand.</p>

      <form onSubmit={post} className="flex flex-col gap-2.5">
        <label htmlFor="team-progress-text" className="sr-only">
          Your update
        </label>
        <input
          id="team-progress-text"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={PROGRESS_TEXT_MAX}
          placeholder="What did you finish or get stuck on?"
          autoComplete="off"
          className="w-full min-h-11 rounded-lg border border-[#d9d5c9] bg-white px-3 py-2 font-body-md text-[14px] leading-6 text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
            {PROGRESS_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tag === t}
                onClick={() => setTag(t)}
                className={
                  "min-h-9 rounded-full px-3 py-1 text-[12.5px] font-semibold leading-5 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                  (tag === t ? `${CHIP[t]} border-current` : "bg-white text-secondary border-[#d9d5c9] hover:border-primary")
                }
              >
                {PROGRESS_TAG_LABEL[t]}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={posting || !text.trim()}
            className="btn-primary shrink-0 min-h-9 px-4 py-1.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            {posting ? "Posting…" : "Post update"}
          </button>
        </div>
      </form>
      <Err text={error} />

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9d5c9] px-4 py-5 text-center font-body-md text-[14px] leading-[1.5] text-secondary">
          No updates yet. Post the first one.
        </p>
      ) : (
        <>
          <ul>
            {shown.map((u) => {
              const name = names[u.author_id] ?? "Former member";
              return (
                <li key={u.id} className={`${ROW} items-start ${busy === u.id ? "opacity-50" : ""}`}>
                  <span
                    className="w-9 h-9 shrink-0 rounded-full bg-surface-container-low text-primary flex items-center justify-center text-[12px] font-semibold"
                    aria-hidden
                  >
                    {initials(name)}
                  </span>
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <span className="font-label-lg text-[14.5px] leading-6 font-semibold text-on-background break-words min-w-0">{name}</span>
                      <span className="text-[12.5px] leading-5 text-secondary">{shortDate(u.created_at)}</span>
                    </div>
                    <span className={`self-start rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-4 ${CHIP[u.tag]}`}>{PROGRESS_TAG_LABEL[u.tag]}</span>
                    <p className="font-body-md text-[14px] leading-[1.5] text-on-background break-words">{u.title}</p>
                  </div>
                  {canDeleteProgress({ isLead, authorId: u.author_id, viewerId }) && (
                    <MoreMenu
                      iconOnly
                      className="shrink-0"
                      items={[
                        {
                          label: "Delete",
                          danger: true,
                          onClick: () => {
                            if (window.confirm("Delete this update?")) void run(u.id, () => deleteProgressAction(teamId, slug, u.id));
                          },
                        },
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {older > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="self-start min-h-9 text-[13px] font-semibold leading-5 text-primary hover:underline underline-offset-4"
            >
              See older updates ({older})
            </button>
          )}
        </>
      )}
    </Card>
  );
}
