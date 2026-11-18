import test from "node:test";
import assert from "node:assert/strict";
import { filterProviders } from "./core.ts";
import { getAllProviders } from "./providers.ts";
import { asksForProviders, MAX_PROVIDER_TERMS, providerSearchTerms } from "./questionTerms.ts";

// Scopes below are what the Explore stream's meta event actually returned for
// each search on localhost (2026-11-18), so the tests cover the real shape:
// the backend files GPCR under topics, not genes.
const EMPTY = { genes: [], diseases: [], assets: [], methods: [] };

const FULL_QUESTION = "I have a target that is a GPCR. What companies can serve me today?";

/** What the card ends up showing: each term searched on its own, merged. */
function companiesFor(terms: string[]): string[] {
  const all = getAllProviders();
  const names: string[] = [];
  for (const t of terms) {
    for (const p of filterProviders(all, t, null, null)) if (!names.includes(p.name)) names.push(p.name);
  }
  return names.slice(0, 3);
}

test("the single word GPCR searches gpcr and finds the membrane-protein companies", () => {
  const terms = providerSearchTerms({ ...EMPTY, topics: ["GPCR"] }, "GPCR");
  assert.deepEqual(terms, ["gpcr"]);
  assert.deepEqual(companiesFor(terms).sort(), ["Cube Biotech", "KACTUS"]);
});

test("the full GPCR question searches gpcr only, never the sentence, and finds the same companies", () => {
  const terms = providerSearchTerms({ ...EMPTY, topics: ["GPCR research"] }, FULL_QUESTION);
  assert.deepEqual(terms, ["gpcr"]);
  assert.ok(!terms.includes(FULL_QUESTION));
  assert.deepEqual(companiesFor(terms).sort(), ["Cube Biotech", "KACTUS"]);
});

test("the full GPCR question with no scope at all still picks gpcr from the question", () => {
  assert.deepEqual(providerSearchTerms(undefined, FULL_QUESTION), ["gpcr"]);
});

test("KRAS pancreatic cancer uses the extracted gene and matches no company", () => {
  const terms = providerSearchTerms(
    { topics: ["KRAS", "pancreatic cancer"], genes: ["KRAS"], diseases: ["pancreatic cancer"], assets: [], methods: [] },
    "KRAS pancreatic cancer"
  );
  assert.deepEqual(terms, ["KRAS"]);
  assert.deepEqual(companiesFor(terms), []);
});

test("a question with no known terms searches nothing", () => {
  const terms = providerSearchTerms({ ...EMPTY, topics: [] }, "What should I do next?");
  assert.deepEqual(terms, []);
  assert.deepEqual(companiesFor(terms), []);
});

test("unknown but meaningful words are searched one by one, capped, without request words", () => {
  const terms = providerSearchTerms({ ...EMPTY, topics: [] }, "Which companies offer organoid lipidomics zebrafish imaging services?");
  assert.equal(terms.length, MAX_PROVIDER_TERMS);
  assert.deepEqual(terms, ["organoid", "lipidomics", "zebrafish"]);
});

test("asksForProviders: companies, providers, vendors, CROs and services; not a plain topic", () => {
  assert.equal(asksForProviders(FULL_QUESTION), true);
  assert.equal(asksForProviders("Any CROs for DMPK?"), true);
  assert.equal(asksForProviders("vendors for cryo-EM"), true);
  assert.equal(asksForProviders("protein expression services"), true);
  assert.equal(asksForProviders("a provider for PDX models"), true);
  assert.equal(asksForProviders("GPCR"), false);
  assert.equal(asksForProviders("KRAS pancreatic cancer"), false);
});
