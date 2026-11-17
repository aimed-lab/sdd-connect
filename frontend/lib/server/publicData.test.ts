import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rateLimit.ts";
import { SEARCH_TEXT_MAX, SEARCH_WINDOW_MS } from "./searchRequest.ts";
import {
  PROVIDERS_LIMIT_DEFAULT,
  PROVIDERS_LIMIT_MAX,
  PROVIDERS_MAX_PER_WINDOW,
  parseProvidersQuery,
  providersBody,
  sparcBody,
} from "./publicData.ts";
import { getAllProviders } from "./providers/providers.ts";
import { CAPABILITIES, capabilityCounts, providerCapabilities } from "./providers/capabilities.ts";
import { filterProviders } from "./providers/core.ts";
import { labPapers } from "../labPapers.ts";
import { patentDetails, sparcPatents, sparcTools } from "../sparcTools.ts";

const all = getAllProviders();
const origin = "https://connect.smartdrugdiscovery.org";
const parse = (qs: string) => parseProvidersQuery(new URLSearchParams(qs));

// ── capability tags ──────────────────────────────────────────────────────────

test("capabilities come from the services text, using the fixed taxonomy", () => {
  const ids = new Set(CAPABILITIES.map((c) => c.id));
  for (const p of all) for (const c of providerCapabilities(p)) assert.ok(ids.has(c), `${p.slug}: ${c}`);
  assert.deepEqual(providerCapabilities({ services: ["in vivo pharmacology", "DMPK"], description: "" }), ["in-vivo", "admet-dmpk"]);
  assert.deepEqual(providerCapabilities({ services: ["PDX models"], description: "" }), ["in-vivo"]);
  assert.deepEqual(providerCapabilities({ services: ["virtual screening"], description: "" }), ["ai-computational"]);
  assert.deepEqual(providerCapabilities({ services: ["high-throughput screening"], description: "" }), ["screening"]);
  assert.deepEqual(providerCapabilities({ services: [], description: "" }), []);
});

test("capabilities on the current directory: in vivo only where the brochure says so", () => {
  const slugs = (id: string) => all.filter((p) => providerCapabilities(p).includes(id)).map((p) => p.slug).sort();
  assert.deepEqual(slugs("in-vivo"), ["pharmaron", "sygnature-discovery"]);
  assert.ok(slugs("screening").includes("hitchem"));
  assert.ok(slugs("med-chem").includes("chemspace"));
  assert.ok(!slugs("screening").includes("chemspace"), "virtual screening is computational, not HTS");
  const chips = capabilityCounts(all);
  assert.ok(chips.every((c) => c.count > 0));
});

test("the directory filter narrows by capability as well as category and words", () => {
  assert.equal(filterProviders(all, "", null, null).length, all.length);
  const vivo = filterProviders(all, "", null, "in-vivo");
  assert.equal(vivo.length, 2);
  assert.equal(filterProviders(all, "", "AI/Software", "in-vivo").length, 0);
  assert.deepEqual(filterProviders(all, "pharmaron", null, "in-vivo").map((p) => p.slug), ["pharmaron"]);
});

// ── GET /api/providers ───────────────────────────────────────────────────────

test("parseProvidersQuery: capability must be known, limit is clamped, q is bounded", () => {
  assert.deepEqual(parse(""), { ok: true, q: "", capability: null, limit: PROVIDERS_LIMIT_DEFAULT });
  assert.deepEqual(parse("capability=IN-VIVO"), { ok: true, q: "", capability: "in-vivo", limit: PROVIDERS_LIMIT_DEFAULT });
  assert.equal(parse("capability=astrology").ok, false);
  assert.equal(parse("limit=1000").ok && (parse("limit=1000") as { limit: number }).limit, PROVIDERS_LIMIT_MAX);
  assert.equal(parse("limit=0").ok && (parse("limit=0") as { limit: number }).limit, 1);
  assert.equal(parse("limit=abc").ok, false);
  assert.equal(parse(`q=${"a".repeat(SEARCH_TEXT_MAX + 1)}`).ok, false);
  assert.equal(parse(`q=${"a".repeat(SEARCH_TEXT_MAX)}`).ok, true);
});

test("providersBody never exposes contact details", () => {
  const body = providersBody(all, { q: "", capability: null, limit: 50 }, origin);
  assert.equal(body.total, all.length);
  assert.equal(body.count, all.length);
  const text = JSON.stringify(body);
  for (const p of all) {
    if (p.email) assert.ok(!text.includes(p.email), `${p.slug}: email`);
    if (p.phone) assert.ok(!text.includes(p.phone), `${p.slug}: phone`);
  }
  for (const rec of body.providers) {
    for (const k of ["email", "phone", "website"]) assert.ok(!(k in rec), k);
    assert.equal(rec.profile_url, `${origin}/collaborate/providers/${rec.slug}`);
  }
  assert.match(body.source, /BioTechX Europe 2026/);
  assert.match(body.source, /not a complete directory/i);
});

test("providersBody filters by capability and words, and honours limit", () => {
  const vivo = providersBody(all, { q: "", capability: "in-vivo", limit: 50 }, origin);
  assert.deepEqual(vivo.providers.map((p) => p.slug).sort(), ["pharmaron", "sygnature-discovery"]);
  assert.ok(vivo.providers.every((p) => p.capabilities.includes("in-vivo")));
  assert.equal(providersBody(all, { q: "", capability: null, limit: 3 }, origin).count, 3);
  assert.equal(providersBody(all, { q: "zzzzqqq", capability: null, limit: 50 }, origin).count, 0);
});

test("the providers and SPARC limiter refuses a burst past the limit", () => {
  const limiter = createRateLimiter(SEARCH_WINDOW_MS, PROVIDERS_MAX_PER_WINDOW);
  for (let i = 0; i < PROVIDERS_MAX_PER_WINDOW; i++) assert.equal(limiter.limited("ip", i), false);
  assert.equal(limiter.limited("ip", 100), true);
});

// ── GET /api/sparc and the patent fields ─────────────────────────────────────

test("sparcBody returns every tool, paper and patent, newest papers first", () => {
  const body = sparcBody();
  assert.equal(body.tools.length, sparcTools.length);
  assert.equal(body.papers.length, labPapers.length);
  assert.equal(body.patents.length, sparcPatents.length);
  for (let i = 1; i < body.papers.length; i++) assert.ok(body.papers[i - 1].year >= body.papers[i].year);
  assert.ok(body.papers.every((p) => p.url === `https://doi.org/${p.doi}`));
});

test("patent fields that are not in the data are not in the output", () => {
  for (const p of sparcBody().patents) {
    const src = sparcPatents.find((x) => x.title === p.title);
    assert.ok(src);
    assert.equal("number" in p, Boolean(src?.number?.trim()));
    assert.equal("licensing_contact" in p, Boolean(src?.licensingContact?.trim()));
  }
});

test("patentDetails keeps only filled-in fields and safe links", () => {
  const base = { title: "T", year: 2020, note: "n" };
  assert.deepEqual(patentDetails(base), {});
  assert.deepEqual(patentDetails({ ...base, number: "  ", status: "" }), {});
  assert.deepEqual(patentDetails({ ...base, number: "US 1,234,567 B2", status: "Granted" }), {
    number: "US 1,234,567 B2",
    status: "Granted",
  });
  assert.deepEqual(patentDetails({ ...base, url: "javascript:alert(1)" }), {});
  assert.deepEqual(patentDetails({ ...base, url: "https://patents.google.com/patent/US1" }), {
    url: "https://patents.google.com/patent/US1",
  });
  assert.deepEqual(patentDetails({ ...base, licensingContact: "otm@example.edu" }), {
    licensingContact: "otm@example.edu",
    licensingHref: "mailto:otm@example.edu",
  });
  assert.deepEqual(patentDetails({ ...base, licensingContact: "Office of Technology Transfer" }), {
    licensingContact: "Office of Technology Transfer",
  });
});
