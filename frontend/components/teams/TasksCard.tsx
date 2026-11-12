"use client";

// The "Tasks" card on a team page (team_tasks, database/migrations/
// 2026-11-11_team_replies_tasks.sql), full width under Progress and Handover.
// Add a task: text, an optional assignee from the team's roster, an optional
// due date. Rows: done checkbox, text, the assignee's initials, the due date
// (overdue open tasks in the error colour, as on project task lists). Open
// tasks first by due date (undated last); done tasks collapse under
// "Done (N)". Any member adds, ticks, reassigns, re-dates or deletes; RLS is
// the real gate. Every control is at least 44px tall.

import { useState } from "react";
import { addTaskAction, deleteTaskAction, updateTaskAction } from "@/app/teams/actions";
import MoreMenu from "@/components/MoreMenu";
import { initials } from "@/lib/server/communityHome/communityHome";
import { TASK_TEXT_MAX, orderTasks, taskDueLabel, type TaskRow } from "@/lib/server/teams/teamWorkRules";
import { Card, Err, ROW, useDo } from "./TeamShelves";

export type TaskMember = { id: string; name: string };

const FIELD =
  "min-h-11 rounded-lg border border-[#d9d5c9] bg-white px-3 py-2 font-body-md text-[14px] leading-6 text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

export default function TasksCard({
  teamId,
  slug,
  tasks,
  members,
  today,
}: {
  teamId: string;
  slug: string;
  tasks: TaskRow[];
  /** The team's members with an account, for the assignee picker. */
  members: TaskMember[];
  /** YYYY-MM-DD, for "Today" and overdue. */
  today: string;
}) {
  const { busy, error, run } = useDo();
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const { open, done } = orderTasks(tasks);
  const adding = busy === "add";
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "Former member" : null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || adding) return;
    await run("add", async () => {
      const res = await addTaskAction(teamId, slug, { text, assignee, due });
      if (res.ok) {
        setText("");
        setAssignee("");
        setDue("");
      }
      return res;
    });
  };

  const row = (t: TaskRow) => (
    <TaskRowView
      key={t.id}
      task={t}
      assigneeName={nameOf(t.assignee_id)}
      members={members}
      today={today}
      busy={busy === t.id}
      onToggle={() => run(t.id, () => updateTaskAction(teamId, slug, t.id, { done: !t.done }))}
      onSave={(patch) => run(t.id, () => updateTaskAction(teamId, slug, t.id, patch))}
      onDelete={() => run(t.id, () => deleteTaskAction(teamId, slug, t.id))}
    />
  );

  return (
    <Card title="Tasks" count={open.length}>
      <form onSubmit={add} className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5">
        <label htmlFor="team-task-text" className="sr-only">
          New task
        </label>
        <input
          id="team-task-text"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={TASK_TEXT_MAX}
          placeholder="Add a task"
          autoComplete="off"
          className={`${FIELD} w-full sm:flex-1 sm:min-w-[220px]`}
        />
        <div className="flex gap-2.5 min-w-0">
          <label htmlFor="team-task-assignee" className="sr-only">
            Assignee
          </label>
          <select
            id="team-task-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:flex-none sm:w-44`}
          >
            <option value="">No one yet</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label htmlFor="team-task-due" className="sr-only">
            Due date
          </label>
          <input
            id="team-task-due"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:flex-none sm:w-40`}
          />
        </div>
        <button
          type="submit"
          disabled={adding || !text.trim()}
          className="btn-primary min-h-11 px-4 rounded-lg font-label-md text-label-md disabled:opacity-50 sm:self-auto"
        >
          {adding ? "Adding…" : "Add task"}
        </button>
      </form>
      <Err text={error} />

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#d9d5c9] px-4 py-5 text-center font-body-md text-[14px] leading-[1.5] text-secondary">
          No tasks yet. Add the first one.
        </p>
      ) : (
        <>
          {open.length > 0 && <ul>{open.map(row)}</ul>}
          {done.length > 0 && (
            <details className="group">
              <summary className="min-h-11 cursor-pointer list-none flex items-center gap-1 text-[13.5px] font-semibold leading-5 text-secondary hover:text-primary">
                <span className="material-symbols-outlined text-[18px] transition-transform group-open:rotate-90" aria-hidden>
                  chevron_right
                </span>
                Done ({done.length})
              </summary>
              <ul className="mt-1">{done.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

function TaskRowView({
  task,
  assigneeName,
  members,
  today,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  task: TaskRow;
  assigneeName: string | null;
  members: TaskMember[];
  today: string;
  busy: boolean;
  onToggle: () => void;
  onSave: (patch: { assignee: string; due: string }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [assignee, setAssignee] = useState(task.assignee_id ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const dueLabel = taskDueLabel(task.due_date, today, task.done);
  const checkboxId = `task-${task.id}`;

  const startEdit = () => {
    // Someone no longer on the team can't be picked again; start from "No one".
    setAssignee(task.assignee_id && members.some((m) => m.id === task.assignee_id) ? task.assignee_id : "");
    setDue(task.due_date ?? "");
    setEditing(true);
  };

  return (
    <li className={`${ROW} !py-1 flex-col !items-stretch gap-1 ${busy ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 min-w-0">
        <label htmlFor={checkboxId} className="shrink-0 min-h-11 min-w-11 flex items-center justify-center cursor-pointer">
          <input
            id={checkboxId}
            type="checkbox"
            checked={task.done}
            disabled={busy}
            onChange={onToggle}
            className="w-5 h-5 accent-[#1A5632] cursor-pointer"
            aria-label={task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`}
          />
        </label>
        <p
          className={
            "min-w-0 flex-1 font-body-md text-[14px] leading-[1.5] break-words " +
            (task.done ? "text-secondary line-through" : "text-on-background")
          }
        >
          {task.text}
        </p>
        {assigneeName && (
          <span
            className="w-8 h-8 shrink-0 rounded-full bg-surface-container-low text-primary flex items-center justify-center text-[11.5px] font-semibold"
            title={assigneeName}
            aria-label={`Assigned to ${assigneeName}`}
          >
            {initials(assigneeName)}
          </span>
        )}
        {dueLabel && (
          <span
            className={
              "shrink-0 text-[12.5px] leading-5 whitespace-nowrap " +
              (dueLabel.overdue ? "text-error font-semibold" : "text-secondary")
            }
          >
            {dueLabel.text}
          </span>
        )}
        <MoreMenu
          iconOnly
          className="shrink-0"
          buttonClassName="min-h-11 min-w-11 justify-center"
          items={[
            { label: "Change assignee or date", onClick: startEdit },
            {
              label: "Delete task",
              danger: true,
              onClick: () => {
                if (window.confirm("Delete this task?")) onDelete();
              },
            },
          ]}
        />
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ assignee, due });
            setEditing(false);
          }}
          className="flex flex-wrap items-center gap-2 pl-11 pb-2"
        >
          <label htmlFor={`${checkboxId}-assignee`} className="sr-only">
            Assignee
          </label>
          <select
            id={`${checkboxId}-assignee`}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:flex-none sm:w-44`}
          >
            <option value="">No one</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${checkboxId}-due`} className="sr-only">
            Due date
          </label>
          <input
            id={`${checkboxId}-due`}
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={`${FIELD} min-w-0 flex-1 sm:flex-none sm:w-40`}
          />
          <button type="submit" className="btn-primary min-h-11 px-4 rounded-lg font-label-md text-label-md">
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 px-3 rounded-lg font-label-md text-label-md text-secondary hover:text-primary"
          >
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}
