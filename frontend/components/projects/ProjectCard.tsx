// One project card on /projects. Pill treatment follows
// components/collaborate/PostCard.tsx (filled pill backgrounds, not the
// bare-text-plus-dot variant the CollaboFest Stitch screen used for its
// header chips — see the AGREE/DIVERGE note in STRUCTURE.md: we standardize
// on the pill).
//
// A project in the CollaboFest 2026 program shows ONE line under its title, its
// description line ("CollaboFest 2026 · C-107"), with a Finalist badge next to
// it for a finalist; it has no separate "CollaboFest 2026" tag. The bottom row
// (registration tag, submission status, deadline) has no divider and is left
// out when there is nothing to put in it.
//
// Server component — no interactivity here, the whole card is a Link.

import { COLABOFEST_PROGRAM } from "@/lib/projectTypes";
import Link from "next/link";
import type { MyProjectSummary } from "@/lib/projectTypes";

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export default function ProjectCard({ project }: { project: MyProjectSummary }) {
  // Registration (challenge_key) and program (program) are different things:
  // the submission pill is for a registration; a winning team in the program has
  // no proposal to submit.
  const isColabofest = !!project.challenge_key;
  const inProgram = project.program === COLABOFEST_PROGRAM;
  const days = project.deadline ? daysUntil(project.deadline) : null;

  const firstLine = (project.description ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const hasFooter = isColabofest || days !== null;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="glass-card group flex flex-col gap-3 rounded-xl p-6 cursor-pointer"
    >
      <div className="flex justify-between items-start gap-4">
        <h2
          title={project.name}
          className="font-headline-md text-headline-md text-on-background group-hover:text-primary transition-colors line-clamp-3"
        >
          {project.name}
        </h2>
        <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm whitespace-nowrap">
          <span className="material-symbols-outlined text-[14px]">group</span>
          {project.member_count} {project.member_count === 1 ? "member" : "members"}
        </span>
      </div>

      {inProgram ? (
        (firstLine || project.finalist) && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {firstLine && <span className="min-w-0 truncate font-body-md text-body-md text-secondary">{firstLine}</span>}
            {project.finalist && (
              <span className="shrink-0 rounded-full border border-[#1A5632] px-2.5 py-0.5 text-[11.5px] font-semibold leading-4 text-[#1A5632]">
                ★ Finalist
              </span>
            )}
          </div>
        )
      ) : (
        project.description && (
          <p className="font-body-md text-body-md text-secondary line-clamp-2">{project.description}</p>
        )
      )}

      {hasFooter && (
        <div className="flex flex-wrap items-center gap-2 mt-auto pt-1">
          {isColabofest && !inProgram && (
            <span className="px-3 py-1 rounded-full bg-surface-container-low text-primary font-label-sm text-label-sm">
              CollaboFest
            </span>
          )}

          {/* Submission status only means something for a project with a
              proposal to submit — an ordinary project never shows this pill. */}
          {isColabofest && (
            <span
              className={
                "inline-flex items-center gap-1 px-3 py-1 rounded-full font-label-sm text-label-sm " +
                (project.proposal_submitted
                  ? "bg-surface-container-low text-on-primary-container"
                  : "bg-surface-dim text-secondary")
              }
            >
              <span className="material-symbols-outlined text-[14px]">
                {project.proposal_submitted ? "check_circle" : "pending"}
              </span>
              {project.proposal_submitted ? "Proposal submitted" : "Not submitted"}
            </span>
          )}

          {days !== null && (
            <span className="ml-auto font-body-sm text-body-sm text-secondary flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              {days >= 0
                ? `Due in ${days} ${days === 1 ? "day" : "days"}`
                : `Deadline was ${ABSOLUTE_DATE.format(new Date(project.deadline as string))}`}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
