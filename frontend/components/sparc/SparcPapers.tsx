"use client";

// Every paper in lib/labPapers.ts, newest year first, as citation rows in the
// look "From the AI.MED Lab" uses on Explore. Each row opens its DOI in a new tab.
//
// Its own rows rather than the shared PaperList: PaperList renders "venue · year"
// twice (one copy for desktop, one for phones), and here each line is written once.

import { useMemo } from "react";
import { labPaperItems } from "@/components/explore/LabPapers";
import { paperMeta } from "@/lib/typeStyles";

export default function SparcPapers() {
  const items = useMemo(() => labPaperItems(), []);
  if (items.length === 0) return null;

  return (
    <ul className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
      {items.map((item) => {
        const { authors, venue, year } = paperMeta(item);
        const meta = [venue, year].filter(Boolean).join(" · ");
        return (
          <li key={item.id} className="py-4 flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
            <div className="min-w-0">
              <h3 className="font-title text-[18px] leading-snug font-medium text-on-background">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h3>
              {authors && <p className="mt-1 text-sm text-secondary truncate">{authors}</p>}
            </div>
            {meta && (
              <p className="shrink-0 text-xs md:text-sm text-secondary md:text-right md:pt-0.5 md:max-w-[260px]">{meta}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
