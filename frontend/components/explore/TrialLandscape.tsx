"use client";

// Trial competitive landscape (#82): one bounded ClinicalTrials.gov search,
// grouped by drug (normalised intervention), then phase and lead sponsor, with
// NCT links, the registry's own total and a CSV of exactly what is shown.

import { useEffect, useState } from "react";
import SectionHeading from "@/components/explore/SectionHeading";
import { BlockSkeleton } from "@/components/explore/Skeletons";
import { statusLabel } from "@/lib/server/communityHome/communityHome";
import { coverageLine, landscapeCsv, landscapeCsvName } from "@/lib/server/explore/trialLandscape";
import type { TrialLandscape as Landscape } from "@/types/explore";

export default function TrialLandscape({
  query,
  statusFilter,
}: {
  query: string;
  statusFilter?: string[];
}) {
  const [data, setData] = useState<Landscape | null>(null);
  const [loading, setLoading] = useState(true);
  const statusKey = (statusFilter ?? []).join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/trial-landscape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, ...(statusKey ? { status_filter: statusKey.split(",") } : {}) }),
        });
        const json = (await res.json()) as Landscape;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, statusKey]);

  const download = () => {
    if (!data) return;
    const blob = new Blob([landscapeCsv(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = landscapeCsvName(query);
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <BlockSkeleton className="h-64" />;

  if (!data || data.error) {
    return (
      <p className="font-body-md text-body-md text-secondary">
        {data?.message ?? "Couldn't load the landscape from ClinicalTrials.gov right now. Please try again in a moment."}
      </p>
    );
  }

  return (
    <section>
      <SectionHeading
        title="Trial landscape"
        subtitle="Grouped by drug, then phase and lead sponsor. Placebo and standard-of-care arms are left out."
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-body-md text-body-md text-on-background">
          {coverageLine(data)} for &ldquo;{data.query}&rdquo;.{" "}
          <span className="text-secondary">
            Not exhaustive: the first {data.fetched} trials ClinicalTrials.gov ranks for this search.
            {data.without_asset > 0 &&
              ` ${data.without_asset} of them name no drug (placebo, standard of care, procedures or observational only) and are not listed.`}
            {data.partial && " Part of the search failed, so fewer trials than usual were fetched."}
          </span>
        </p>
        {data.groups.length > 0 && (
          <button
            type="button"
            onClick={download}
            className="px-3 py-1.5 rounded-md border border-outline-variant/40 font-label-md text-label-md text-primary hover:bg-surface-container-low whitespace-nowrap"
          >
            Download CSV
          </button>
        )}
      </div>

      {data.groups.length === 0 ? (
        <p className="font-body-md text-body-md text-secondary">No drug interventions in these trials.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
          <table className="w-full min-w-[640px] text-left font-body-sm text-body-sm">
            <thead className="bg-surface-container-low text-secondary font-label-md text-label-md">
              <tr>
                <th scope="col" className="px-4 py-2">Drug</th>
                <th scope="col" className="px-4 py-2">Phase</th>
                <th scope="col" className="px-4 py-2">Lead sponsor</th>
                <th scope="col" className="px-4 py-2">Trials</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) =>
                g.rows.map((r, i) => (
                  <tr key={`${g.key}|${r.phase}|${r.sponsor}`} className={i === 0 ? "border-t border-outline-variant/30" : ""}>
                    {i === 0 && (
                      <th scope="rowgroup" rowSpan={g.rows.length} className="px-4 py-2 align-top font-medium text-on-background">
                        {g.asset}
                        <span className="block font-normal text-secondary">
                          {g.trial_count} {g.trial_count === 1 ? "trial" : "trials"}
                          {g.aliases.length > 0 && ` · also listed as ${g.aliases.join(", ")}`}
                        </span>
                      </th>
                    )}
                    <td className="px-4 py-2 align-top whitespace-nowrap">{r.phase}</td>
                    <td className="px-4 py-2 align-top">{r.sponsor}</td>
                    <td className="px-4 py-2 align-top">
                      <ul className="space-y-1">
                        {r.trials.map((t) => (
                          <li key={t.nct_id}>
                            <a
                              href={t.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t.title}
                              className="text-primary hover:underline underline-offset-4"
                            >
                              {t.nct_id}
                            </a>
                            {t.status && <span className="text-secondary"> · {statusLabel(t.status)}</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
