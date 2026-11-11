// The collected sources of a wiki page (page_evidence), one tab at a time:
// Papers (papers and preprints), Datasets, or More sources (every other kind).
// Rendered with the same lists and tiles Explore uses (PaperList for papers and
// preprints, OtherSections for everything else). page_evidence keeps no
// per-source `raw` details, so tiles show the title, summary and date and hide
// the rest. Every item carries an id (sourceAnchor) so a citation in a section
// can scroll to it.

import PaperList from "@/components/explore/PaperList";
import OtherSections from "@/components/explore/OtherSections";
import SectionHeading from "@/components/explore/SectionHeading";
import {
  WIKI_TAB_EMPTY,
  groupEvidenceByKind,
  splitEvidenceByTab,
  type EvidenceRow,
} from "@/lib/server/pages/pageViewHelpers";

const TITLE = { papers: "Papers", datasets: "Datasets", other: "More sources" } as const;

function countLine(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many} collected for this page.`;
}

export default function PageSources({ evidence, tab }: { evidence: EvidenceRow[]; tab: "papers" | "datasets" | "other" }) {
  const rows = splitEvidenceByTab(evidence)[tab];
  if (rows.length === 0) {
    return (
      <section>
        <SectionHeading title={TITLE[tab]} />
        <p className="font-body-md text-body-md text-secondary">{WIKI_TAB_EMPTY[tab]}</p>
      </section>
    );
  }
  const sections = groupEvidenceByKind(rows);

  if (tab === "papers") {
    const papers = sections.find((s) => s.kind === "paper");
    const preprints = sections.find((s) => s.kind === "preprint");
    return (
      <section className="flex flex-col gap-12">
        <SectionHeading title="Papers" subtitle={countLine(rows.length, "paper", "papers")} className="mb-0" />
        {papers && (
          <div>
            <PaperList items={papers.items} hideSave anchors />
          </div>
        )}
        {preprints && (
          <div>
            <h3 className="mb-4 font-title text-[22px] leading-tight font-medium text-on-background">Preprints</h3>
            <PaperList items={preprints.items} preprint hideSave anchors />
          </div>
        )}
      </section>
    );
  }

  if (tab === "datasets") {
    return (
      <section className="flex flex-col gap-6">
        <SectionHeading title="Datasets" subtitle={countLine(rows.length, "dataset", "datasets")} className="mb-0" />
        <OtherSections sections={sections} hideSave hideHeadings anchors />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-12">
      <SectionHeading title="More sources" subtitle={countLine(rows.length, "source", "sources")} className="mb-0" />
      <OtherSections sections={sections} expandGenesets hideSave anchors />
    </section>
  );
}
