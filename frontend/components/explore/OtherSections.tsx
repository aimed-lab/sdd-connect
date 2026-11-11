"use client";

// Everything on an Explore or search page that has no dedicated editorial
// component: clinical trials, compounds, targets, people, lab resources, gene
// sets, and so on. Tile-style cards under a SectionHeading. Gene sets are the
// niche type and always come LAST, collapsed behind a "Show gene sets (N)"
// button.

import { useState } from "react";
import SectionHeading from "@/components/explore/SectionHeading";
import { ApprovalTile, GrantTile, ResultTile, TILE_GRID, TrialTile } from "@/components/explore/ResultTiles";
import { sourceAnchor } from "@/lib/server/pages/pageViewHelpers";
import type { ExploreSection } from "@/types/explore";

const SECTION_TITLE: Record<string, string> = {
  approval: "FDA-approved drugs",
  preprint: "Preprints",
  geneset: "Gene sets",
  compound: "Compounds",
  target: "Target-disease evidence",
  trial: "Clinical trials",
  grant: "Funding & grants",
  resource: "Lab resources",
  person: "People",
  episode: "From the podcast",
};

export const sectionTitle = (kind: string) =>
  SECTION_TITLE[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

// Open Targets' association score aggregates evidence across source types
// (genetic association, literature, animal model, ...) via a weighted
// harmonic mean; it is not a biological-importance ranking. One short line,
// not a card-level essay.
const TARGET_NOTE =
  "Open Targets' association score reflects breadth of evidence sources, not biological importance.";

function Grid({
  section,
  projectId,
  hideSave,
  anchors,
}: {
  section: ExploreSection;
  projectId?: string;
  hideSave?: boolean;
  anchors?: boolean;
}) {
  return (
    <div className={TILE_GRID}>
      {section.items.map((item) => {
        const tile =
          item.kind === "trial" ? (
            <TrialTile key={item.id} item={item} projectId={projectId} hideSave={hideSave} />
          ) : item.kind === "approval" ? (
            <ApprovalTile key={item.id} item={item} projectId={projectId} hideSave={hideSave} />
          ) : item.kind === "grant" ? (
            <GrantTile key={item.id} item={item} projectId={projectId} hideSave={hideSave} />
          ) : (
            <ResultTile key={item.id} item={item} projectId={projectId} hideSave={hideSave} />
          );
        // The wrapper only exists with `anchors` (wiki pages), so Explore's own markup is unchanged.
        return anchors ? (
          <div
            key={item.id}
            id={sourceAnchor(item.id)}
            className="min-w-0 scroll-mt-24 rounded-2xl target:ring-2 target:ring-primary target:ring-offset-2"
          >
            {tile}
          </div>
        ) : (
          tile
        );
      })}
    </div>
  );
}

export default function OtherSections({
  sections,
  projectId,
  expandGenesets = false,
  hideSave = false,
  hideHeadings = false,
  anchors = false,
}: {
  sections: ExploreSection[];
  projectId?: string;
  /** Show gene sets open instead of behind the "Show gene sets" button (the Gene sets chip). */
  expandGenesets?: boolean;
  /** Leave out the bookmark on every tile. */
  hideSave?: boolean;
  /** Leave out each section's own heading (the caller shows one). */
  hideHeadings?: boolean;
  /** Give every tile an id (sourceAnchor) so a link can scroll to it and it is
   *  marked when it is the link's target. Used by wiki pages only. */
  anchors?: boolean;
}) {
  const [showGenesets, setShowGenesets] = useState(false);
  const withItems = sections.filter((s) => s.items.length > 0);
  const normal = withItems.filter((s) => s.kind !== "geneset");
  const genesets = withItems.filter((s) => s.kind === "geneset");
  const genesetCount = genesets.reduce((n, s) => n + s.items.length, 0);

  return (
    <>
      {normal.map((section) => (
        <section key={section.tool}>
          {!hideHeadings && (
            <SectionHeading
              title={sectionTitle(section.kind)}
              subtitle={section.kind === "target" ? TARGET_NOTE : undefined}
            />
          )}
          <Grid section={section} projectId={projectId} hideSave={hideSave} anchors={anchors} />
        </section>
      ))}

      {genesetCount > 0 && (
        <section>
          {expandGenesets || showGenesets ? (
            <>
              <SectionHeading title="Gene sets" />
              {genesets.map((s) => (
                <Grid key={s.tool} section={s} projectId={projectId} hideSave={hideSave} anchors={anchors} />
              ))}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowGenesets(true)}
              className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
            >
              Show gene sets ({genesetCount})
            </button>
          )}
        </section>
      )}
    </>
  );
}
