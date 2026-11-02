// The Projects view of the ColaboFest 2026 community: one white box, one row per
// project, the title only. A project the viewer is on (or any, for SPARC staff and
// admins) has an "Open →" link; every other row says "Team only" with a lock and has
// no link and no id in the markup. Server component.

import Link from "next/link";
import type { ProjectRow } from "@/lib/server/communityHome/colabofest";

export default function ColabofestProjectsView({ base, rows }: { base: string; rows: ProjectRow[] }) {
  return (
    <section className="flex flex-col gap-4 min-w-0">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] leading-5 border-b border-[#e2dfd6] pb-2.5">
        <Link href={base} scroll={false} className="inline-flex items-center gap-1.5 font-semibold text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10v10h5v-6h4v6h5V10" />
          </svg>
          Community home
        </Link>
        <span className="text-[#9a9a94]" aria-hidden>
          ›
        </span>
        <span className="text-on-background">Projects</span>
      </nav>

      <h2 className="font-title text-[24px] leading-8 text-on-background">Projects</h2>

      {rows.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">No projects yet.</p>
      ) : (
        <ul className="rounded-[10px] border border-[#e2dfd6] bg-white divide-y divide-[#ece9e0] overflow-hidden">
          {rows.map((r, i) => (
            <li key={r.id ?? `locked-${i}`} className={`flex items-center justify-between gap-3 px-4 py-3 ${r.mine ? "bg-[#f3f1ea]" : ""}`}>
              <span className="min-w-0 break-words text-[14.5px] leading-6 text-on-background">{r.name}</span>
              {r.id ? (
                <Link href={`/projects/${r.id}`} className="shrink-0 text-[13px] font-semibold leading-5 text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4">
                  Open →
                </Link>
              ) : (
                <span className="shrink-0 inline-flex items-center gap-1 text-[12.5px] leading-5 text-secondary">
                  <span className="material-symbols-outlined text-[15px]" aria-hidden>
                    lock
                  </span>
                  Team only
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
