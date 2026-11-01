"use client";

// The Tasks view of a ColaboFest project: up to three lists (Your team, SPARC, Southern
// Research), each with a small header and its own bar ("2 of 5 done"). A row is a round
// status circle (a green ✓ when done), the title, a one-line description, the owner, the
// due date and, for people allowed to change it, "Mark done" / "Undo". The lead and the
// SPARC team (managers) mark team items; managers also add, edit and delete items in
// every list, with an owner and a due date. Members only read. The server re-checks
// every change (lib/server/projectWorkspace/cfChecklist.ts).

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  cfAddItemAction,
  cfDeleteItemAction,
  cfEditItemAction,
  cfSetItemDoneAction,
  setFinalistTaskAction,
  type CfItemInput,
} from "@/app/projects/[id]/actions";
import MoreMenu from "@/components/MoreMenu";
import { dueLabel } from "@/lib/server/projectWorkspace/status";
import { barLine, canEditList, canMarkItem, type CfList, type CfRow, type ListKey } from "@/lib/server/projectWorkspace/cfTasks";

const INPUT =
  "w-full bg-white border border-outline-variant/60 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary";

type Owner = { user_id: string; label: string };

function ItemForm({
  initial,
  owners,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CfItemInput;
  owners: Owner[];
  submitLabel: string;
  onSubmit: (v: CfItemInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(v);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#e8e4da] bg-white p-3.5 flex flex-col gap-2.5">
      <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Task" aria-label="Task" maxLength={300} className={INPUT} autoFocus />
      <div className="grid grid-cols-2 gap-2.5">
        <select value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} aria-label="Owner" className={INPUT}>
          <option value="">No owner</option>
          {owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.label}
            </option>
          ))}
        </select>
        <input type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} aria-label="Due date" className={INPUT} />
      </div>
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2 rounded-[10px] text-[13px] font-bold leading-5 disabled:opacity-60">
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ProjectTasksView({
  projectId,
  lists,
  role,
  owners,
  ownerIdByName,
  startAdd,
}: {
  projectId: string;
  lists: CfList[];
  role: string;
  owners: Owner[];
  /** The owner's user id by their shown name, for the edit form's first value. */
  ownerIdByName: Record<string, string>;
  /** Open the add form of the first list on arrival (the "+" sheet's Add task). */
  startAdd: boolean;
}) {
  const router = useRouter();
  const canEdit = canEditList(role);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ListKey | null>(startAdd && canEdit ? lists[0]?.key ?? null : null);
  const [editing, setEditing] = useState<string | null>(null);

  const done = (res: { ok: true } | { ok: false; error: string }) => {
    if (res.ok) {
      setAdding(null);
      setEditing(null);
      router.refresh();
    }
    return res;
  };

  const toggle = async (r: CfRow) => {
    if (busy) return;
    setBusy(r.id ?? r.taskKey ?? r.label);
    setError(null);
    const res = r.id ? await cfSetItemDoneAction(projectId, r.id, !r.done) : await setFinalistTaskAction(projectId, r.taskKey ?? "", !r.done);
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  const remove = async (r: CfRow) => {
    if (!r.id || !window.confirm(`Delete "${r.label}"?`)) return;
    setError(null);
    const res = await cfDeleteItemAction(projectId, r.id);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <div className="flex flex-col gap-7">
      {lists.map((l) => {
        const pct = l.total === 0 ? 0 : Math.round((l.done / l.total) * 100);
        const dues = l.rows.map((r) => r.due);
        const sharedDue = dues.length > 0 && dues[0] && dues.every((d) => d === dues[0]) ? dueLabel(dues[0]) : null;

        if (l.rows.length === 0 && adding !== l.key) {
          return (
            <section key={l.key} aria-label={l.title} className="flex items-baseline justify-between gap-3 border-t border-[#e2dfd6] pt-3">
              <h3 className="font-title text-[18px] leading-6 text-on-background">{l.title}</h3>
              <span className="text-[12.5px] leading-5 text-secondary">
                No tasks yet
                {canEdit && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => setAdding(l.key)} className="text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4">
                      + Add
                    </button>
                  </>
                )}
              </span>
            </section>
          );
        }

        return (
          <section key={l.key} aria-label={l.title} className="flex flex-col gap-3">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-title text-[18px] leading-6 text-on-background">
                  {l.title}
                  {sharedDue && <span className="ml-1.5 font-body-md text-[12.5px] text-secondary">· due {sharedDue}</span>}
                </h3>
                <span className="text-[12.5px] leading-5 text-secondary">{barLine(l.done, l.total)}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-[#e9e6dc] overflow-hidden" role="progressbar" aria-label={`${l.title} progress`} aria-valuemin={0} aria-valuemax={l.total} aria-valuenow={l.done}>
                <div className="h-full bg-[#1A5632]" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <ul className="rounded-[10px] border border-[#e2dfd6] bg-white divide-y divide-[#ece9e0]">
              {l.rows.map((r, idx) => {
                const key = r.id ?? r.taskKey ?? r.label;
                const mark = canMarkItem(role, l.key);
                if (editing === r.id && r.id) {
                  return (
                    <li key={key} className="p-2.5">
                      <ItemForm
                        initial={{ label: r.label, due: r.due ?? "", assigneeId: r.owner ? ownerIdByName[r.owner] ?? "" : "" }}
                        owners={owners}
                        submitLabel="Save"
                        onSubmit={async (v) => done(await cfEditItemAction(projectId, r.id as string, v))}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  );
                }
                return (
                  <li key={key} className="px-3.5 py-3 flex flex-wrap items-start gap-x-3 gap-y-2">
                    <span
                      className={
                        "grid place-items-center shrink-0 w-6 h-6 rounded-full text-[12px] font-bold " +
                        (r.done ? "bg-[#1A5632] text-white" : "bg-[#f3f1ea] text-[#222]")
                      }
                      aria-hidden
                    >
                      {r.done ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <div className="min-w-0 flex-1 basis-[60%]">
                      <p className={"text-[14px] leading-6 break-words " + (r.done ? "text-secondary line-through" : "text-on-background")}>
                        <span className="sr-only">{r.done ? "Done. " : "To do. "}</span>
                        {r.label}
                      </p>
                      {((!r.done && r.description) || r.owner || (!sharedDue && r.due)) && (
                        <p className="text-[12px] leading-5 text-secondary">
                          {!r.done && r.description && <span className="line-clamp-2">{r.description}</span>}
                          {[r.owner, !sharedDue && r.due ? `Due ${dueLabel(r.due) ?? r.due}` : null].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    {mark && !r.done && (
                      <button
                        type="button"
                        onClick={() => toggle(r)}
                        disabled={busy !== null}
                        className="shrink-0 rounded-md border border-[#1A5632] bg-transparent px-2.5 py-1 text-[12px] font-semibold leading-4 text-[#1A5632] hover:bg-[#f3f1ea] disabled:opacity-60 max-sm:ml-9"
                      >
                        {busy === key ? "…" : "Mark as done"}
                      </button>
                    )}
                    {r.done && (
                      <span className="shrink-0 text-[12px] leading-5 text-secondary max-sm:ml-9">
                        <span className="font-semibold text-[#1A5632]">Done</span>
                        {mark && (
                          <>
                            {" · "}
                            <button type="button" onClick={() => toggle(r)} disabled={busy !== null} className="underline underline-offset-2 hover:text-on-background disabled:opacity-60">
                              {busy === key ? "…" : "Undo"}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                    {canEdit && r.id && !r.taskKey && (
                      <MoreMenu
                        iconOnly
                        className="shrink-0"
                        items={[
                          { label: "Edit", onClick: () => setEditing(r.id) },
                          { label: "Delete", danger: true, onClick: () => void remove(r) },
                        ]}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {canEdit &&
              (adding === l.key ? (
                <ItemForm
                  initial={{ label: "", due: "", assigneeId: "" }}
                  owners={owners}
                  submitLabel="Add task"
                  onSubmit={async (v) => done(await cfAddItemAction(projectId, l.key, v))}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setAdding(l.key)}
                    className="text-[13px] font-semibold leading-5 text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4"
                  >
                    + Add task
                  </button>
                </div>
              ))}
          </section>
        );
      })}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
