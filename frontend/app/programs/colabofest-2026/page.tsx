// ColaboFest 2026 projects — /programs/colabofest-2026.
//
// For anyone who is a lead or manager on at least one ColaboFest project (the
// program manager across the ColaboFest projects, and each team's leads). Lists
// the ColaboFest projects the viewer is a member of, finalists first and then by
// project code, one card each: the code, a Finalist badge, any warning badge,
// the title, team size, the task lists that have items, one status line (tasks
// and the last announcement) and links to the project and its announcements.
// The rules are in lib/server/projectWorkspace/programCards.ts. All reads use
// the viewer's own session, so row-level security decides which projects come
// back. Anyone else gets a 404.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader, { PageShell } from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/auth";
import { getColabofestProgram } from "@/lib/server/projectWorkspace/program";
import { STALE_ANNOUNCEMENT_LABEL, programCountLine, type TaskStatus } from "@/lib/server/projectWorkspace/programCards";
import { tabHref } from "@/lib/server/projectWorkspace/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ColaboFest 2026 projects | SmartDrugDiscovery", robots: { index: false } };

// The tasks part of the status line: red-brown when overdue, amber when due today.
const TASK_TONE: Record<TaskStatus["tone"], string> = {
  overdue: "text-[#9a3412] font-medium",
  today: "text-[#8a4a00] font-medium",
  later: "text-secondary",
  done: "text-secondary",
};

const BADGE = "rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold leading-4";

export default async function ColabofestProgramPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=%2Fprograms%2Fcolabofest-2026");

  const result = await getColabofestProgram();
  if (result.status === "no_access") notFound();
  if (result.status === "error") {
    return (
      <PageShell>
        <p className="font-body-md text-body-md text-error" role="alert">
          {result.error}
        </p>
      </PageShell>
    );
  }

  const finalists = result.cards.filter((c) => c.finalist).length;

  return (
    <PageShell>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 mb-6 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Your projects
      </Link>
      <PageHeader
        title="ColaboFest 2026 projects"
        subtitle="How each ColaboFest project is doing: tasks, due dates and the latest announcements, in one place."
        statsLine={result.cards.length > 0 ? programCountLine(result.cards.length, finalists) : undefined}
      />

      {result.cards.length === 0 ? (
        <div className="tile p-8 max-w-xl" style={{ background: "var(--type-other-bg)" }}>
          <p className="font-body-md text-body-md text-secondary">
            No ColaboFest projects yet. When a team is added as a ColaboFest 2026 project and you are on it, it shows up here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {result.cards.map((c) => (
            <article key={c.id} className="h-full rounded-2xl bg-white shadow-[0_1px_2px_rgba(40,36,28,0.05)] p-6 flex flex-col gap-3 min-w-0">
              {(c.code || c.finalist || c.needsHelp || c.staleAnnouncement) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.code && <span className="mr-1 text-[12.5px] leading-5 text-secondary">{c.code}</span>}
                  {c.finalist && <span className={`${BADGE} border border-[#1A5632] text-[#1A5632]`}>★ Finalist</span>}
                  {c.needsHelp && <span className={`${BADGE} bg-error/10 text-error`}>Needs help</span>}
                  {c.staleAnnouncement && <span className={`${BADGE} bg-[#f8ecd6] text-[#8a4a00]`}>{STALE_ANNOUNCEMENT_LABEL}</span>}
                </div>
              )}

              <h2 title={c.name} className="font-title text-[22px] leading-tight font-medium text-on-background break-words line-clamp-4">
                {c.name}
              </h2>
              <p className="font-body-sm text-body-sm text-secondary">
                {c.teamSize} {c.teamSize === 1 ? "member" : "members"}
              </p>

              {c.rows.length === 0 ? (
                <p className="font-body-md text-body-md text-secondary">No tasks yet</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {c.rows.map((r) => (
                    <li key={r.key} className="flex items-center justify-between gap-3 font-body-md text-body-md">
                      <span className="text-on-background">{r.label}</span>
                      <span className="text-secondary shrink-0">
                        {r.done} of {r.total} done
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="font-body-sm text-body-sm text-secondary">
                {c.tasks && (
                  <>
                    <span className={TASK_TONE[c.tasks.tone]}>{c.tasks.text}</span>
                    {" · "}
                  </>
                )}
                {c.announcements}
              </p>

              <div className="mt-auto pt-2 flex items-center gap-4">
                <Link href={tabHref(c.id, "overview")} className="btn-primary px-4 py-2 rounded-lg font-label-md text-label-md">
                  Open project
                </Link>
                <Link href={tabHref(c.id, "announcements")} className="font-label-md text-label-md text-primary hover:underline underline-offset-4">
                  Announcements
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}
