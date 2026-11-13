// Turn what a researcher pastes into a paper identifier. Pure, no imports:
// used by the lookup (fetchPaper.ts, server) and by the "Share a file" screen
// (browser) to decide whether a lookup is worth calling at all.
//
// Accepted:
//   DOI            10.1101/2024.01.01.123456
//   doi: prefix    doi:10.1101/...
//   doi.org link   https://doi.org/10.1101/...  (also dx.doi.org, www., http)
//   PubMed ID      12345678, PMID: 12345678
//   PubMed link    https://pubmed.ncbi.nlm.nih.gov/12345678/
//                  https://www.ncbi.nlm.nih.gov/pubmed/12345678

export type PaperId = { kind: "doi"; id: string } | { kind: "pmid"; id: string };

const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const PMID_RE = /^\d{1,9}$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A DOI with surrounding punctuation from a sentence removed. */
function tidyDoi(s: string): string {
  return s.replace(/[.,;:)\]}>"']+$/, "");
}

export function parsePaperInput(raw: string | null | undefined): PaperId | null {
  let s = (raw ?? "").trim().replace(/^[<"'(]+|[>"')]+$/g, "").trim();
  if (!s) return null;

  // doi.org link
  const doiUrl = /^(?:https?:\/\/)?(?:www\.)?(?:dx\.)?doi\.org\/(.+)$/i.exec(s);
  if (doiUrl) {
    const doi = tidyDoi(safeDecode(doiUrl[1].split(/[?#]/)[0]).trim());
    return DOI_RE.test(doi) ? { kind: "doi", id: doi } : null;
  }

  // PubMed link (the current site, and the older ncbi.nlm.nih.gov/pubmed/ form)
  const pubmedUrl =
    /^(?:https?:\/\/)?(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov\/|ncbi\.nlm\.nih\.gov\/pubmed\/)(\d{1,9})(?:[/?#].*)?$/i.exec(s);
  if (pubmedUrl) return { kind: "pmid", id: pubmedUrl[1] };

  // PMID: 12345 / PMID12345
  const pmidLabel = /^pmid\s*:?\s*(\d{1,9})$/i.exec(s);
  if (pmidLabel) return { kind: "pmid", id: pmidLabel[1] };

  if (PMID_RE.test(s)) return { kind: "pmid", id: s };

  s = s.replace(/^doi\s*:?\s*/i, "");
  const doi = tidyDoi(s);
  if (DOI_RE.test(doi)) return { kind: "doi", id: doi };

  return null;
}
