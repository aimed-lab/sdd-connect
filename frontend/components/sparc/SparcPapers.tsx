"use client";

// Every paper in lib/labPapers.ts, newest year first, as the same citation rows
// "From the AI.MED Lab" uses on Explore. Each row opens its DOI in a new tab.

import { useMemo } from "react";
import { labPaperItems } from "@/components/explore/LabPapers";
import PaperList from "@/components/explore/PaperList";

export default function SparcPapers() {
  const items = useMemo(() => labPaperItems(), []);
  return <PaperList items={items} hideSave />;
}
