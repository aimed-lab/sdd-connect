// "What's new" on a wiki page: what refresh runs added (page_updates),
// newest day first, one line per day ("Oct 20: 3 new papers, 1 new FDA
// approval") that opens to the items, each linking out. The page's first build
// is not an update; it is the single line at the bottom, "Page created <date>
// with <N> sources". Server component (native <details>).
//
// Each item: a type chip (the Explore tile tint for its type), the title as
// the link, then the source and the item's own date in grey, read from the
// page_evidence row the update points at (already loaded for the page, no
// extra query). Same-day items whose titles differ only by a trailing
// "[ATAC-seq]"-style bracket show once, "(3 related datasets)".

import SectionHeading from "@/components/explore/SectionHeading";
import {
  WIKI_TAB_EMPTY,
  groupUpdatesByDate,
  whatsNewItems,
  type EvidenceRow,
  type UpdateRow,
} from "@/lib/server/pages/pageViewHelpers";
import { TYPE_STYLES, typeKeyForKind } from "@/lib/typeStyles";

export default function WhatsNew({
  updates,
  evidence,
  createdLine,
}: {
  updates: UpdateRow[];
  evidence: Pick<EvidenceRow, "id" | "source" | "date_iso">[];
  createdLine: string;
}) {
  const groups = groupUpdatesByDate(updates);
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));

  return (
    <section>
      <SectionHeading title="What's new" subtitle="Resources added to this page, newest first." />
      {groups.length === 0 && (
        <p className="mb-3 font-body-md text-body-md text-secondary">{WIKI_TAB_EMPTY.new}</p>
      )}
      <div className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
        {groups.map((group, i) => (
          <details key={group.date} open={i === 0} className="group py-3">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-body-md text-body-md text-on-background">
              <span>{group.headline}</span>
              <span className="material-symbols-outlined text-secondary text-base transition-transform group-open:rotate-180">
                expand_more
              </span>
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {whatsNewItems(group.items, evidenceById).map((u) => {
                const t = TYPE_STYLES[typeKeyForKind(u.kind)];
                return (
                  <li key={u.id} className="font-body-sm text-body-sm leading-snug">
                    <span
                      className="mr-2 inline-block rounded-full px-2 py-px align-[1px] text-[11px] font-medium whitespace-nowrap"
                      style={{ background: t.bg, color: t.fg }}
                    >
                      {u.chip}
                    </span>
                    {u.url ? (
                      <a
                        href={u.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-on-background hover:text-primary hover:underline underline-offset-4"
                      >
                        {u.title}
                      </a>
                    ) : (
                      <span className="text-on-background">{u.title}</span>
                    )}
                    {u.relatedLabel && <span className="ml-1 text-secondary">{u.relatedLabel}</span>}
                    {u.meta && <span className="ml-2 text-xs text-secondary">{u.meta}</span>}
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
        <p className="py-3 font-body-sm text-body-sm text-secondary">{createdLine}</p>
      </div>
    </section>
  );
}
