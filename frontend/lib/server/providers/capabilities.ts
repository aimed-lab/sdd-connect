// Service Providers directory: a small, fixed capability taxonomy. Each
// provider's tags are derived from its OWN services list and description in
// lib/data/providers.json (nothing is added by hand), so a tag only appears
// when the company's brochure text says so. Pure; safe for client components.

export type Capability = { id: string; label: string };

type Rule = Capability & { patterns: RegExp[] };

const RULES: Rule[] = [
  {
    id: "in-vivo",
    label: "In vivo / PDX",
    patterns: [/\bin vivo\b/, /\bxenograft/, /\bpdx\b/, /\bcdx\b/, /\banimal models?\b/],
  },
  {
    id: "screening",
    label: "HTS / screening",
    patterns: [
      /(?<!virtual )\bscreening\b/,
      /\bhts\b/,
      /\bhigh[- ]throughput\b/,
      /\bhit identification\b/,
      /\b384-well\b/,
      /\bdiversity library\b/,
    ],
  },
  {
    id: "med-chem",
    label: "Med-chem & synthesis",
    patterns: [
      /\bmedicinal chemistry\b/,
      /\bdiscovery chemistry\b/,
      /\bchemistry & cadd\b/,
      /\bsynthesis\b/,
      /\bmake-on-demand\b/,
      /\bhit-to-lead\b/,
      /\blead optimi[sz]ation\b/,
      /\bdirect-to-biology\b/,
    ],
  },
  {
    id: "admet-dmpk",
    label: "ADMET / DMPK",
    patterns: [/\badmet?\b/, /\bdmpk\b/, /\bd2adme\b/, /\bpharmacokinetic/, /\btoxicity\b/, /\btoxicology\b/, /\bsafety assessment\b/],
  },
  {
    id: "cmc",
    label: "CMC & manufacturing",
    patterns: [/\bgmp manufacturing\b/, /\bmanufacturing\b/, /\bcommercial production\b/, /\bhpapi\b/, /\bformulation\b/, /\bcmc\b/],
  },
  {
    id: "protein-structure",
    label: "Protein & structural biology",
    patterns: [
      /\bprotein expression\b/,
      /\bprotein purification\b/,
      /\bexpression and purification\b/,
      /\brecombinant proteins?\b/,
      /\bmembrane proteins?\b/,
      /\bstructural biology\b/,
      /\bcryo-em\b/,
      /\bcrystallography\b/,
    ],
  },
  {
    id: "assays",
    label: "Assays & bioanalytics",
    patterns: [/\bassays?\b/, /\bin vitro\b/, /\bbiophysical\b/, /\bbioanaly/, /\bngs\b/],
  },
  {
    id: "ai-computational",
    label: "AI & computational",
    patterns: [
      /\bai\b/,
      /\bmachine learning\b/,
      /\bcadd\b/,
      /\bcomputational\b/,
      /\bin silico\b/,
      /\bvirtual screening\b/,
      /\bcheminformatics\b/,
      /\bsimulation\b/,
      /\bllm\b/,
      /\bhpc\b/,
      /\bsoftware\b/,
    ],
  },
  {
    id: "compounds",
    label: "Compound libraries",
    patterns: [/\bcompound (?:library|libraries|catalogs?)\b/, /\bdiversity library\b/, /\bcompounds in stock\b/, /\blibrary design\b/],
  },
  {
    id: "regulatory",
    label: "Regulatory support",
    patterns: [/\bregulatory\b/, /\breach dossiers?\b/, /\bghs classification\b/],
  },
];

/** The taxonomy, in the order chips appear. */
export const CAPABILITIES: Capability[] = RULES.map(({ id, label }) => ({ id, label }));

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function isCapability(id: string): boolean {
  return BY_ID.has(id);
}

export function capabilityLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Capability ids for one provider, in taxonomy order, from its services and
 *  description only. */
export function providerCapabilities(p: { services: string[]; description: string }): string[] {
  const text = [...p.services, p.description].join(" \n ").toLowerCase();
  return RULES.filter((r) => r.patterns.some((re) => re.test(text))).map((r) => r.id);
}

/** Chips: only capabilities at least one provider has, with counts, in taxonomy order. */
export function capabilityCounts(
  providers: { services: string[]; description: string }[]
): (Capability & { count: number })[] {
  const counts = new Map<string, number>();
  for (const p of providers) for (const id of providerCapabilities(p)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return CAPABILITIES.filter((c) => counts.has(c.id)).map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
}
