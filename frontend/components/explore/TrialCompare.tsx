"use client";

// Side-by-side table of up to three trials picked with each tile's "Compare"
// toggle on Explore's trial results. Built only from the trials' own fields and
// the fixed glossary in lib/server/explore/trialGlossary.ts; no generated text.

import { compareRows, MAX_COMPARE } from "@/lib/server/explore/trialGlossary";
import type { ExploreItem, TrialRaw } from "@/types/explore";

export default function TrialCompare({
  items,
  onRemove,
  onClear,
}: {
  items: ExploreItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return (
      <p className="mb-4 font-body-sm text-body-sm text-secondary">
        Tick <strong className="font-medium">Compare</strong> on up to {MAX_COMPARE} trials to see them side by side.
      </p>
    );
  }

  const rows = compareRows(items);
  return (
    <div className="mb-6 rounded-[14px] bg-surface-container-low p-4" aria-label="Trial comparison" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-title text-[18px] font-medium text-on-background">
          Compare trials ({items.length} of {MAX_COMPARE})
        </h3>
        <button type="button" onClick={onClear} className="text-sm text-primary hover:underline underline-offset-4">
          Clear
        </button>
      </div>
      {items.length < 2 ? (
        <p className="mt-2 font-body-sm text-body-sm text-secondary">Pick at least one more trial to compare.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[13px] leading-snug">
            <thead>
              <tr>
                <th scope="col" className="w-32 p-2 align-top font-medium text-secondary">
                  <span className="sr-only">Field</span>
                </th>
                {items.map((item) => {
                  const nct = ((item.raw ?? {}) as TrialRaw).nct_id;
                  return (
                    <th key={item.id} scope="col" className="p-2 align-top font-medium text-on-background">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline underline-offset-4">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                      <span className="mt-1 flex items-center gap-2 text-xs font-normal text-secondary">
                        {nct}
                        <button
                          type="button"
                          onClick={() => onRemove(item.id)}
                          className="text-primary hover:underline underline-offset-4"
                          aria-label={`Remove ${item.title} from the comparison`}
                        >
                          Remove
                        </button>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-outline-variant/40">
                  <th scope="row" className="p-2 align-top font-medium text-secondary">
                    {row.label}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={items[i].id}
                      className={"p-2 align-top " + (cell === "Not listed" ? "text-secondary" : "text-on-background")}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-secondary">
            From each trial&apos;s ClinicalTrials.gov record. Check the full record before making any decision.
          </p>
        </div>
      )}
    </div>
  );
}
