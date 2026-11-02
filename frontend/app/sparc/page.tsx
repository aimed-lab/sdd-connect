// SPARC Center resources — /sparc. Four sections (ids publications, tools, datasets,
// patents) that the home map links to.
//
//   * Publications: every paper in lib/labPapers.ts, newest first.
//   * Tools and Patents: lib/sparcTools.ts (copied from aimed-lab.org/software).
//   * Datasets: the lab's own entry in lib/curated.ts, chosen by the id list below.
//
// Server component. Not in the top nav.

import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import SectionHeading from "@/components/explore/SectionHeading";
import SparcPapers from "@/components/sparc/SparcPapers";
import { curatedDatasets, curatedToExploreItem } from "@/lib/curated";
import { LAB_PUBLICATIONS_URL } from "@/lib/labPapers";
import { SPARC_SOFTWARE_URL, sparcPatents, sparcTools } from "@/lib/sparcTools";

// Cell Maps for AI (CM4AI) is the lab's own data release (cm4ai.org; the lab's
// "Cell Maps for Artificial Intelligence" paper is in labPapers.ts). Tools and patents
// come from lib/sparcTools.ts (copied from aimed-lab.org/software).
const SPARC_DATASET_IDS = ["cm4ai"];

// On this page only: cards are white with a thin border instead of the type tint.
// ItemCard reads the tint from these CSS variables, so it needs no change.
const WHITE_CARDS =
  "[--type-dataset-bg:#ffffff] [--type-tool-bg:#ffffff] [&_.tile]:border [&_.tile]:border-[#e2dfd6]";
const LINK = "text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4";

export const metadata = { title: "SPARC Center resources" };

export default function SparcPage() {
  const datasets = curatedDatasets.filter((d) => SPARC_DATASET_IDS.includes(d.id)).map((d) => curatedToExploreItem(d, "dataset"));

  return (
    <section className="bg-[var(--explore-bg)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
        <Link
          href="/"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1 mb-6"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Home
        </Link>

        <div className="max-w-3xl space-y-3 mb-10">
          <h1 className="font-display-lg text-display-lg text-on-background">SPARC Center resources</h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Publications, tools and datasets from the UAB Systems Pharmacology AI Research Center and the AI.MED Lab.
          </p>
        </div>

        <div className="flex flex-col gap-14">
          <section id="publications" className="scroll-mt-20">
            <SectionHeading title="Publications" />
            <SparcPapers />
            <div className="mt-5">
              <a
                href={LAB_PUBLICATIONS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-label-md text-label-md text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4"
              >
                All AI.MED Lab publications ↗
              </a>
            </div>
          </section>

          <section id="tools" className="scroll-mt-20">
            <SectionHeading title="Tools" />
            <ul className="grid gap-4 sm:grid-cols-2">
              {sparcTools.map((t) => (
                <li key={t.name} className="rounded-[14px] border border-[#e2dfd6] bg-white p-5 flex flex-col gap-1.5">
                  <h3 className="font-title text-[18px] leading-6 text-on-background">{t.name}</h3>
                  <p className="text-[12px] leading-4 text-secondary">{t.category}</p>
                  <p className="font-body-md text-[14px] leading-5 text-on-background">{t.oneLine}</p>
                  <p className="mt-auto pt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] leading-5">
                    {t.links.map((l) => {
                      const papers = t.links.filter((x) => x.label === "Paper");
                      const text = l.label === "Paper" && papers.length > 1 ? `Paper ${papers.indexOf(l) + 1}` : l.label;
                      return (
                        <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                          {text}
                        </a>
                      );
                    })}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-5">
              <a href={SPARC_SOFTWARE_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-secondary hover:text-primary hover:underline underline-offset-4">
                All AI.MED Lab software ↗
              </a>
            </div>
          </section>

          <section id="datasets" className="scroll-mt-20">
            <SectionHeading title="Datasets" />
            {datasets.length === 0 ? (
              <p className="font-body-md text-body-md text-secondary">No datasets are listed here yet.</p>
            ) : (
              <div className={`grid gap-4 sm:grid-cols-2 ${WHITE_CARDS}`}>
                {datasets.map((d) => (
                  <ItemCard key={d.id} item={d} />
                ))}
              </div>
            )}
          </section>

          <section id="patents" className="scroll-mt-20">
            <SectionHeading title="Patents" />
            <ul className="divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
              {sparcPatents.map((p) => (
                <li key={p.title} className="py-3.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-title text-[17px] leading-6 text-on-background">{p.title}</p>
                    <span className="shrink-0 text-[13px] leading-5 text-secondary">{p.year}</span>
                  </div>
                  <p className="text-[13px] leading-5 text-secondary">{p.note}</p>
                </li>
              ))}
            </ul>
            <div className="mt-5">
              <a href={SPARC_SOFTWARE_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-secondary hover:text-primary hover:underline underline-offset-4">
                Source: AI.MED Lab software and patents ↗
              </a>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
