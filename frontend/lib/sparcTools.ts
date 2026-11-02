// AI.MED Lab software and patents for /sparc. Copied from https://aimed-lab.org/software.
// Names, wording and links are as published there; do not edit them without checking the source.
// Safe for client components (types and data only).

export type SparcToolLink = { label: "GitHub" | "Paper" | "Launch"; href: string };

export type SparcTool = {
  name: string;
  category: string;
  oneLine: string;
  links: SparcToolLink[];
};

export const SPARC_SOFTWARE_URL = "https://aimed-lab.org/software";

export const sparcTools: SparcTool[] = [
  {
    name: "ProteoLens",
    category: "Visualization",
    oneLine:
      "Visual analytic tool for multi-scale database-driven biological network data mining, enabling interactive exploration of protein interaction networks.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/ProteoLens" },
      { label: "Paper", href: "https://doi.org/10.1186/1471-2105-9-S9-S5" },
    ],
  },
  {
    name: "HIP2",
    category: "Proteomics",
    oneLine:
      "Database of healthy human plasma proteome profiles enabling identification of disease-associated protein biomarkers through comparative analysis.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/HIP2" },
      { label: "Paper", href: "https://doi.org/10.1186/1755-8794-1-12" },
    ],
  },
  {
    name: "GeneTerrain",
    category: "Visualization",
    oneLine:
      "3D terrain visualization mapping gene expression profiles onto native biomolecular interaction networks for intuitive biomarker discovery.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/GeneTerrain-Web-APP" },
      { label: "Paper", href: "https://doi.org/10.3389/fbinf.2025.1602850" },
    ],
  },
  {
    name: "PAGER",
    category: "Pathway Analysis",
    oneLine:
      "Electronic repository integrating pathways, annotated gene lists, and gene signatures with network-level enrichment analysis for functional genomics.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/PAGER-Web-APP" },
      { label: "Paper", href: "https://doi.org/10.3389/fgene.2022.820361" },
      { label: "Paper", href: "https://doi.org/10.1093/nar/gkx1013" },
    ],
  },
  {
    name: "WIPER",
    category: "Network Analysis",
    oneLine:
      "Ranks biomolecular associations in weighted in-path edge networks to identify functional connections between genes, pathways, and diseases.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/WIPER" },
      { label: "Paper", href: "https://doi.org/10.1007/s40484-019-0180-y" },
    ],
  },
  {
    name: "PGC",
    category: "Single-cell Analysis",
    oneLine:
      "Discovers spatially informative biomarker genes from single-cell RNA-seq embedding data using polar Gini curve quantification.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/Polar-Gini-Curve" },
      { label: "Paper", href: "https://doi.org/10.1016/j.gpb.2020.09.006" },
    ],
  },
  {
    name: "SEAS",
    category: "Statistical Analysis",
    oneLine:
      "Annotates and enriches sample-level metadata neighborhoods to discover phenotype-associated clinical and molecular patterns from cohort data.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/SEAS" },
      { label: "Paper", href: "https://doi.org/10.3389/fdata.2021.725276" },
    ],
  },
  {
    name: "WINNER",
    category: "Network Analysis",
    oneLine:
      "Prioritizes disease-associated biomolecules by weighted in-network node expansion and ranking on protein interaction and functional genomics networks.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/WINNER" },
      { label: "Paper", href: "https://doi.org/10.3389/fdata.2022.1016606" },
    ],
  },
  {
    name: "Mondrian Map",
    category: "Pathway Analysis",
    oneLine:
      "Applies Piet Mondrian-inspired visual abstraction with language model embeddings to reveal differential pathway activity across conditions.",
    links: [
      { label: "GitHub", href: "https://github.com/aimed-lab/mondrian-map" },
      { label: "Paper", href: "https://doi.org/10.1101/2024.04.11.589093" },
    ],
  },
  {
    name: "Talent Knowledge Map",
    category: "Knowledge Networks",
    oneLine:
      "Interactive knowledge graph for exploring interdisciplinary research teams, expertise, and collaboration networks across NIH Bridge2AI and CFDE communities.",
    links: [
      { label: "Launch", href: "http://cm4aikg.vercel.app/" },
      { label: "Paper", href: "https://doi.org/10.1145/3543873.3587579" },
    ],
  },
];

export type SparcPatent = { title: string; year: number; note: string };

export const sparcPatents: SparcPatent[] = [
  {
    title: "Inhibitors of Phosphoglycerate Dehydrogenase and Uses Thereof",
    year: 2025,
    note: "Filed July 2025 by the University of Alabama at Birmingham.",
  },
  {
    title: "Disease-specific Drug-protein Connectivity Mapping",
    year: 2010,
    note: "Filed June 2010 by Indiana University. Licensed to a commercial company in May 2013.",
  },
  {
    title: "Multi-level Terrains as a Visual Analytic Platform for Discovery and Validation of Molecular Biomarkers",
    year: 2010,
    note: "Filed March 2010 by Indiana University. Licensed to a commercial company in May 2013.",
  },
  {
    title: "4-protein Biomarker Panel for the Diagnosis of Lymphoma from Biospecimen",
    year: 2010,
    note: "Filed March 2010 by Indiana University. Licensed to a commercial company in May 2013.",
  },
  {
    title: "Mining Protein Interaction Networks",
    year: 2006,
    note: "Filed September 2006 by Indiana University.",
  },
  {
    title: "Computer Software for Sequence Selection",
    year: 2005,
    note: "Filed March 2005 by Affymetrix, Inc.",
  },
  {
    title: "A Relational Database Operator to perform Biological Sequence Similarity Search",
    year: 2001,
    note: "US provisional patent filed January 2001.",
  },
];
