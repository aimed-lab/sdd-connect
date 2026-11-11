"use client";

// The "Handover" card on a team page: four fixed rows, always shown, in this
// order: Box folder, GitHub repository, Final report, Handover note. A row is
// a Shared documents row with a slot (lib/server/teams/teamRules.ts explains);
// slotted rows are shown here and not under Shared documents. Any member fills
// an empty row; whoever added it, or a lead, changes or removes it.

import { useState } from "react";
import { clearHandoverAction, setHandoverAction } from "@/app/teams/actions";
import MoreMenu from "@/components/MoreMenu";
import { shortDate } from "@/lib/server/communityHome/communityHome";
import { HANDOVER_NOTE_HINT, HANDOVER_NOTE_MAX, canChangeHandover, type HandoverRow } from "@/lib/server/teams/teamRules";
import { byLine } from "@/lib/server/teams/teamUi";
import { Card, Err, SMALL_BTN, useDo } from "./TeamShelves";

export type HandoverResource = { id: string; added_by: string; url: string | null; description: string; created_at: string };

const FIELD =
  "w-full rounded-lg border border-[#d9d5c9] bg-white px-3 py-2 font-body-md text-[14px] leading-6 text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

function Row({
  teamId,
  slug,
  row,
  names,
  viewerId,
  isLead,
}: {
  teamId: string;
  slug: string;
  row: HandoverRow<HandoverResource>;
  names: Record<string, string>;
  viewerId: string;
  isLead: boolean;
}) {
  const { busy, error, run } = useDo();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const r = row.resource;
  const isNote = row.kind === "note";
  const canChange = canChangeHandover({ isLead, addedBy: r ? r.added_by : null, viewerId });
  const saving = busy === "save";
  const inputId = `team-handover-${row.slot}`;

  const startEditing = () => {
    setValue(r ? (isNote ? r.description : (r.url ?? "")) : "");
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || saving) return;
    await run("save", async () => {
      const res = await setHandoverAction(teamId, slug, row.slot, value);
      if (res.ok) setEditing(false);
      return res;
    });
  };

  const menu =
    r && canChange ? (
      <MoreMenu
        iconOnly
        className="shrink-0"
        items={[
          { label: isNote ? "Edit note" : "Change link", onClick: startEditing },
          {
            label: "Remove",
            danger: true,
            onClick: () => {
              if (window.confirm(`Remove the ${row.label.toLowerCase()} from Handover?`)) {
                void run("remove", () => clearHandoverAction(teamId, slug, row.slot));
              }
            },
          },
        ]}
      />
    ) : null;

  return (
    <li
      className={
        "rounded-xl px-3.5 py-3 flex flex-col gap-2 min-w-0 " +
        (r ? "border border-[#e8e4da]" : "border border-dashed border-[#d9d5c9]") +
        (busy ? " opacity-60" : "")
      }
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className="font-label-lg text-[14.5px] leading-6 font-semibold text-on-background">{row.label}</p>
          {r ? (
            <>
              {isNote && <p className="font-body-md text-[14px] leading-[1.5] text-on-background whitespace-pre-line break-words">{r.description}</p>}
              <p className="text-[12.5px] leading-5 text-secondary">{byLine(names[r.added_by], shortDate(r.created_at))}</p>
            </>
          ) : (
            <p className="text-[13px] leading-5 text-secondary">{isNote ? HANDOVER_NOTE_HINT : "Not added yet"}</p>
          )}
        </div>
        {r && !isNote && r.url && (
          <a href={r.url} target="_blank" rel="noopener noreferrer" className={`${SMALL_BTN} shrink-0 min-h-9`}>
            Open
          </a>
        )}
        {!r && !editing && (
          <button type="button" onClick={startEditing} className={`${SMALL_BTN} shrink-0 min-h-9`}>
            {isNote ? "Write note" : "Add link"}
          </button>
        )}
        {menu}
      </div>

      {editing && (
        <form onSubmit={save} className="flex flex-col gap-2">
          <label htmlFor={inputId} className="sr-only">
            {isNote ? "Handover note" : `Link to the ${row.label.toLowerCase()}`}
          </label>
          {isNote ? (
            <textarea
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={HANDOVER_NOTE_MAX}
              rows={4}
              placeholder={HANDOVER_NOTE_HINT}
              autoFocus
              className={FIELD}
            />
          ) : (
            <input
              id={inputId}
              type="url"
              inputMode="url"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://"
              autoComplete="off"
              autoFocus
              className={`${FIELD} min-h-11`}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving || !value.trim()}
              className="btn-primary min-h-9 px-4 py-1.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`${SMALL_BTN} min-h-9`}>
              Cancel
            </button>
            {isNote && (
              <span className="text-[12.5px] leading-5 text-secondary">
                {value.length} of {HANDOVER_NOTE_MAX}
              </span>
            )}
          </div>
        </form>
      )}
      <Err text={error} />
    </li>
  );
}

export default function HandoverCard({
  teamId,
  slug,
  rows,
  names,
  viewerId,
  isLead,
}: {
  teamId: string;
  slug: string;
  /** Always the four rows, in order; `resource` is null for an empty one. */
  rows: HandoverRow<HandoverResource>[];
  names: Record<string, string>;
  viewerId: string;
  isLead: boolean;
}) {
  return (
    <Card title="Handover">
      <p className="-mt-2 font-body-md text-[14px] leading-[1.5] text-secondary">
        Where the team&apos;s finished work lives. Anyone joining later starts here.
      </p>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <Row key={row.slot} teamId={teamId} slug={slug} row={row} names={names} viewerId={viewerId} isLead={isLead} />
        ))}
      </ul>
    </Card>
  );
}
