// What to search the provider directory for, given an Explore search.
//
// The directory search (core.ts matchesQuery) needs EVERY word of its query to
// appear in a company's text, so a whole question ("I have a target that is a
// GPCR. What companies can serve me today?") never matches anything. This picks
// short search terms instead, and never returns the whole sentence:
//   1. an entity the Explore backend extracted (gene/target, method, drug,
//      disease), when it found one;
//   2. otherwise any known provider-synonym phrase (synonyms.ts) in the
//      backend's topics or the typed question ("gpcr", "cryo-em");
//   3. otherwise the meaningful leftover words (no stopwords, no words that
//      only ask for a company, like "companies" or "services").
// Each returned term is searched on its own. Pure; safe for client components.

import { SYNONYM_GROUPS } from "./synonyms.ts";

export const MAX_PROVIDER_TERMS = 3;

const ENTITY_KEYS = ["genes", "methods", "assets", "diseases"] as const;

// Words that ask for a company rather than say what the work is. Also what
// asksForProviders() looks for.
const PROVIDER_WORDS = [
  "company", "companies", "provider", "providers", "vendor", "vendors", "cro", "cros",
  "service", "services", "supplier", "suppliers", "cdmo", "cdmos", "contractor", "contractors",
];

const STOPWORDS = new Set([
  ...PROVIDER_WORDS,
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "from", "with", "by",
  "about", "into", "as", "is", "are", "was", "were", "be", "been", "am", "it", "its", "this", "that",
  "these", "those", "there", "here", "i", "me", "my", "we", "us", "our", "you", "your", "they", "them",
  "what", "which", "who", "whom", "where", "when", "why", "how", "can", "could", "would", "should",
  "will", "shall", "may", "might", "must", "do", "does", "did", "have", "has", "had", "get", "got",
  "need", "needs", "want", "wants", "looking", "look", "find", "help", "helps", "serve", "support",
  "offer", "offers", "provide", "provides", "recommend", "best", "good", "any", "some", "someone",
  "anyone", "please", "today", "now", "currently", "available", "work", "working", "project",
  "projects", "lab", "labs", "research", "study", "studies", "target", "targets", "thing", "things",
  "like", "also", "just", "very", "more", "most", "other", "able", "use", "using", "based",
  "new", "latest", "show", "list", "tell", "know", "out", "up", "if", "so", "not", "no", "yes",
  "next", "then", "first", "step", "steps", "start", "begin", "way", "ways", "idea", "ideas",
  "go", "make", "take", "try", "see", "say", "think", "question", "questions", "answer", "answers",
]);

function tokens(text: string): string[] {
  return (text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Every synonym term as tokens, longest first, so "g protein coupled receptor"
// wins over a shorter term inside it.
const SYNONYM_TERMS = SYNONYM_GROUPS.flatMap((group, g) =>
  group.map((term) => ({ group: g, term, toks: tokens(term) }))
)
  .filter((t) => t.toks.length > 0)
  .sort((a, b) => b.toks.length - a.toks.length);

/** True when the question asks for companies, providers, vendors, CROs or services. */
export function asksForProviders(text: string): boolean {
  const words = new Set(tokens(text));
  return PROVIDER_WORDS.some((w) => words.has(w));
}

function scopeEntity(scope: Record<string, unknown> | undefined): string | null {
  for (const key of ENTITY_KEYS) {
    const values = scope?.[key];
    if (!Array.isArray(values)) continue;
    const first = values.find((v): v is string => typeof v === "string" && v.trim() !== "");
    if (first) return first.trim();
  }
  return null;
}

/** The search terms for the "Companies that might help" card (at most
 *  MAX_PROVIDER_TERMS, each searched separately); [] when nothing in the
 *  search is worth looking up. */
export function providerSearchTerms(scope: Record<string, unknown> | undefined, question: string): string[] {
  const entity = scopeEntity(scope);
  if (entity) return [entity];

  const topics = Array.isArray(scope?.topics) ? scope.topics.filter((t): t is string => typeof t === "string") : [];
  const toks = tokens([...topics, question].join(" \n "));

  // Known synonym phrases, one per synonym group, in the order they appear.
  const known: string[] = [];
  const seenGroups = new Set<number>();
  const used = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue;
    const hit = SYNONYM_TERMS.find((t) => t.toks.every((tok, k) => toks[i + k] === tok));
    if (!hit) continue;
    hit.toks.forEach((_, k) => used.add(i + k));
    if (!seenGroups.has(hit.group)) {
      seenGroups.add(hit.group);
      known.push(hit.term);
    }
  }
  if (known.length > 0) return known.slice(0, MAX_PROVIDER_TERMS);

  // Otherwise the meaningful leftover words, each on its own.
  const words: string[] = [];
  for (const w of toks) {
    if (STOPWORDS.has(w) || (w.length < 3 && !/\d/.test(w)) || words.includes(w)) continue;
    words.push(w);
  }
  return words.slice(0, MAX_PROVIDER_TERMS);
}
