// The read-only JSON behind GET /api/providers and GET /api/sparc: input
// bounds and the response bodies. Pure (no next/* imports), so the route
// handlers stay thin and node --test can check the bodies against the
// OpenAPI spec.
//
// Providers: never any contact details (no email, phone or website); each
// record links to its profile page instead.

import { labPapers, doiUrl, LAB_PUBLICATIONS_URL } from "../labPapers.ts";
import { SPARC_SOFTWARE_URL, patentDetails, sparcPatents, sparcTools } from "../sparcTools.ts";
import { CAPABILITIES, capabilityCounts, isCapability, providerCapabilities } from "./providers/capabilities.ts";
import { categoryLabel, filterProviders, visibleKeyFacts, type KeyFact, type Provider } from "./providers/core.ts";
import { SEARCH_TEXT_MAX } from "./searchRequest.ts";

/** Per IP, per server instance, over SEARCH_WINDOW_MS (one minute). */
export const PROVIDERS_MAX_PER_WINDOW = 60;
export const SPARC_MAX_PER_WINDOW = 60;

export const PROVIDERS_LIMIT_MIN = 1;
export const PROVIDERS_LIMIT_MAX = 50;
export const PROVIDERS_LIMIT_DEFAULT = 50;

export const PROVIDERS_SOURCE_NOTE =
  "Companies met at BioTechX Europe 2026. Not a complete directory; no academic core facilities yet. Capabilities are derived from each company's own services text.";

export type ProvidersQuery =
  | { ok: true; q: string; capability: string | null; limit: number }
  | { ok: false; message: string };

export function parseProvidersQuery(params: URLSearchParams): ProvidersQuery {
  const q = (params.get("q") ?? "").trim();
  if (q.length > SEARCH_TEXT_MAX) return { ok: false, message: `q is too long (at most ${SEARCH_TEXT_MAX} characters).` };
  const rawCap = (params.get("capability") ?? "").trim().toLowerCase();
  if (rawCap && !isCapability(rawCap)) {
    return { ok: false, message: `Unknown capability. Use one of: ${CAPABILITIES.map((c) => c.id).join(", ")}.` };
  }
  const rawLimit = params.get("limit");
  let limit = PROVIDERS_LIMIT_DEFAULT;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const n = Number(rawLimit);
    if (!Number.isFinite(n)) return { ok: false, message: "limit must be a number." };
    limit = Math.min(PROVIDERS_LIMIT_MAX, Math.max(PROVIDERS_LIMIT_MIN, Math.trunc(n)));
  }
  return { ok: true, q, capability: rawCap || null, limit };
}

export type PublicProvider = {
  slug: string;
  name: string;
  category: string;
  category_label: string;
  capabilities: string[];
  services: string[];
  description: string;
  location: string;
  event: string;
  key_facts: KeyFact[];
  profile_url: string;
};

export type ProvidersBody = {
  source: string;
  total: number;
  count: number;
  query: { q: string; capability: string | null; limit: number };
  capabilities: { id: string; label: string; count: number }[];
  providers: PublicProvider[];
};

export function toPublicProvider(p: Provider, origin: string): PublicProvider {
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    category_label: categoryLabel(p.category),
    capabilities: providerCapabilities(p),
    services: p.services,
    description: p.description,
    location: p.location,
    event: p.event,
    key_facts: visibleKeyFacts(p),
    profile_url: new URL(`/collaborate/providers/${p.slug}`, origin).toString(),
  };
}

export function providersBody(
  all: Provider[],
  query: { q: string; capability: string | null; limit: number },
  origin: string
): ProvidersBody {
  const matched = filterProviders(all, query.q, null, query.capability);
  const providers = matched.slice(0, query.limit).map((p) => toPublicProvider(p, origin));
  return {
    source: PROVIDERS_SOURCE_NOTE,
    total: all.length,
    count: providers.length,
    query: { q: query.q, capability: query.capability, limit: query.limit },
    capabilities: capabilityCounts(all),
    providers,
  };
}

export type SparcBody = {
  source: { software: string; publications: string };
  tools: { name: string; category: string; one_line: string; links: { label: string; href: string }[] }[];
  papers: { title: string; venue: string; year: number; doi: string; url: string }[];
  patents: {
    title: string;
    year: number;
    note: string;
    number?: string;
    status?: string;
    url?: string;
    licensing_contact?: string;
  }[];
};

export function sparcBody(): SparcBody {
  return {
    source: { software: SPARC_SOFTWARE_URL, publications: LAB_PUBLICATIONS_URL },
    tools: sparcTools.map((t) => ({
      name: t.name,
      category: t.category,
      one_line: t.oneLine,
      links: t.links.map((l) => ({ label: l.label, href: l.href })),
    })),
    papers: [...labPapers]
      .sort((a, b) => b.year - a.year)
      .map((p) => ({ title: p.title, venue: p.venue, year: p.year, doi: p.doi, url: doiUrl(p.doi) })),
    patents: sparcPatents.map((p) => {
      const d = patentDetails(p);
      return {
        title: p.title,
        year: p.year,
        note: p.note,
        ...(d.number ? { number: d.number } : {}),
        ...(d.status ? { status: d.status } : {}),
        ...(d.url ? { url: d.url } : {}),
        ...(d.licensingContact ? { licensing_contact: d.licensingContact } : {}),
      };
    }),
  };
}
