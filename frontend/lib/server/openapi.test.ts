// Contract test: /api/openapi.json (lib/server/openapi.ts) against the real
// route handlers. For every documented path it reads app/api/<path>/route.ts
// and checks the exported methods, the rate limiter's real arguments, the
// text cut-offs, and that every literal JSON body a handler can send (and its
// status) is documented. Bodies built by pure helpers (providers, SPARC,
// podcast hits) are generated for real and validated against the schemas.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { OPENAPI_SPEC } from "./openapi.ts";
import * as rateLimitMod from "./rateLimit.ts";
import * as searchRequestMod from "./searchRequest.ts";
import * as publicDataMod from "./publicData.ts";
import { getAllProviders } from "./providers/providers.ts";
import { searchEpisodes, type SearchableEpisode } from "./explore/podcastSearch.ts";

type S = Record<string, any>;
const spec = OPENAPI_SPEC as unknown as S;
const schemas = spec.components.schemas as Record<string, S>;

function resolve(s: S): S {
  if (s && typeof s.$ref === "string") {
    const name = s.$ref.replace("#/components/schemas/", "");
    assert.ok(schemas[name], `unresolved ${s.$ref}`);
    return resolve(schemas[name]);
  }
  return s;
}

function typeOk(t: string, v: unknown): boolean {
  if (t === "null") return v === null;
  if (t === "array") return Array.isArray(v);
  if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v);
  if (t === "integer") return Number.isInteger(v);
  return typeof v === t;
}

/** A small JSON Schema check: enough for the keywords openapi.ts uses. */
function validate(schema: S, value: unknown, at = "$"): string[] {
  const s = resolve(schema);
  if (s.oneOf) {
    const ok = (s.oneOf as S[]).filter((o) => validate(o, value, at).length === 0).length;
    return ok === 1 ? [] : [`${at}: matches ${ok} of oneOf`];
  }
  const errs: string[] = [];
  if (s.type) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t: string) => typeOk(t, value))) return [`${at}: expected ${types.join("|")}, got ${JSON.stringify(value)}`];
  }
  if (s.enum && !s.enum.includes(value)) errs.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if ("const" in s && s.const !== value) errs.push(`${at}: expected ${s.const}`);
  if (typeof value === "string" && s.maxLength !== undefined && value.length > s.maxLength) errs.push(`${at}: too long`);
  if (Array.isArray(value)) {
    if (s.maxItems !== undefined && value.length > s.maxItems) errs.push(`${at}: too many items`);
    if (s.items) value.forEach((v, i) => errs.push(...validate(s.items, v, `${at}[${i}]`)));
  } else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o)) errs.push(`${at}: missing ${k}`);
    for (const [k, v] of Object.entries(o)) {
      if (s.properties?.[k]) errs.push(...validate(s.properties[k], v, `${at}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${at}: undocumented key ${k}`);
    }
  }
  return errs;
}

function responseSchema(op: S, status: string): S {
  const r = op.responses?.[status];
  assert.ok(r, `${op.operationId}: status ${status} is not documented`);
  return resolve(r.content["application/json"].schema);
}

// ── reading route sources ────────────────────────────────────────────────────

const appDir = path.join(process.cwd(), "app");
const routeFile = (p: string) => path.join(appDir, p, "route.ts");
const source = (p: string) => readFileSync(routeFile(p), "utf8");

/** The text between a "(" or "{" at `start` and its matching close. */
function balanced(src: string, start: number): string {
  const open = src[start];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start + 1, i);
  }
  throw new Error("unbalanced");
}

/** Top-level keys of an object literal's body (shorthand and key: value). */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let part = "";
  const flush = () => {
    const t = part.trim();
    part = "";
    if (!t || t.startsWith("...")) return;
    const m = t.match(/^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/);
    if (m) keys.push(m[1]);
  };
  for (const ch of body) {
    if ("{[(".includes(ch)) depth++;
    if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) flush();
    else part += ch;
  }
  flush();
  return keys;
}

type JsonCall = { status: string; keys: string[] | null };

/** Every NextResponse.json(...) call: its status and, for a literal object
 *  body, the top-level keys (null when the body is built elsewhere). */
function jsonCalls(src: string): JsonCall[] {
  const out: JsonCall[] = [];
  const re = /NextResponse\.json\(/g;
  for (let m; (m = re.exec(src)); ) {
    const args = balanced(src, m.index + m[0].length - 1);
    const status = args.match(/status:\s*(\d{3})/)?.[1] ?? "200";
    const first = args.trimStart();
    out.push({ status, keys: first.startsWith("{") ? topLevelKeys(balanced(first, 0)) : null });
  }
  return out;
}

const constants: Record<string, number> = Object.fromEntries(
  Object.entries({ ...rateLimitMod, ...searchRequestMod, ...publicDataMod }).filter(([, v]) => typeof v === "number")
) as Record<string, number>;

function evalConst(expr: string): number {
  const names = Object.keys(constants);
  return new Function(...names, `return (${expr});`)(...names.map((n) => constants[n]));
}

const operations = Object.entries(spec.paths as Record<string, S>).flatMap(([p, item]) =>
  Object.entries(item).map(([method, op]) => ({ path: p, method: method.toUpperCase(), op: op as S }))
);

// ── the spec itself ──────────────────────────────────────────────────────────

test("the spec is OpenAPI 3.1 and documents exactly the public read endpoints", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.deepEqual(Object.keys(spec.paths).sort(), [
    "/api/communities-summary",
    "/api/communities/match",
    "/api/explore",
    "/api/explore-stats",
    "/api/papers",
    "/api/podcast-search",
    "/api/providers",
    "/api/sparc",
  ]);
  const ids = operations.map((o) => o.op.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const { op } of operations) assert.ok(op.responses["200"], op.operationId);
  JSON.stringify(spec, (_k, v) => {
    if (v && typeof v === "object" && typeof v.$ref === "string") resolve(v);
    return v;
  });
});

test("the spec route itself exists and is static", () => {
  const src = source("api/openapi.json");
  assert.match(src, /OPENAPI_SPEC/);
  assert.match(src, /force-static/);
});

// ── the spec against each route handler ──────────────────────────────────────

test("every documented path has a route that exports exactly the documented methods", () => {
  for (const p of Object.keys(spec.paths)) {
    assert.ok(existsSync(routeFile(p)), `${p}: no route.ts`);
    const exported = [...source(p).matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    const documented = Object.keys(spec.paths[p]).map((m) => m.toUpperCase());
    assert.deepEqual(exported.sort(), documented.sort(), p);
  }
});

test("documented rate limits are the ones the routes create", () => {
  for (const { path: p, op } of operations) {
    const calls = [...source(p).matchAll(/createRateLimiter\(([^,]+),([^)]+)\)/g)];
    if (!op["x-rate-limit"]) {
      assert.equal(calls.length, 0, `${p}: has a limiter the spec does not mention`);
      continue;
    }
    assert.equal(calls.length, 1, p);
    const windowMs = evalConst(calls[0][1]);
    const max = evalConst(calls[0][2]);
    assert.equal(op["x-rate-limit"].requests, max, `${p}: requests`);
    assert.equal(op["x-rate-limit"].window_seconds, windowMs / 1000, `${p}: window`);
    assert.ok(op.responses["429"], `${p}: 429 not documented`);
  }
});

test("documented text cut-offs match the routes", () => {
  for (const { path: p, op } of operations) {
    for (const param of op.parameters ?? []) {
      if (param["x-truncate-at"] === undefined) continue;
      assert.match(source(p), new RegExp(`\\.slice\\(0, ${param["x-truncate-at"]}\\)`), `${p}: ${param.name}`);
    }
  }
  assert.equal(spec.paths["/api/papers"].get.parameters[0].schema.maxLength, searchRequestMod.SEARCH_TEXT_MAX);
  assert.equal(spec.paths["/api/explore"].post["x-max-body-bytes"], searchRequestMod.EXPLORE_BODY_MAX_CHARS);
});

test("every JSON body a route sends has a documented status and only documented keys", () => {
  for (const { path: p, op } of operations) {
    const calls = jsonCalls(source(p));
    assert.ok(calls.length > 0, p);
    for (const call of calls) {
      const schema = responseSchema(op, call.status);
      if (!call.keys) continue;
      for (const k of call.keys) assert.ok(schema.properties?.[k], `${p} ${call.status}: key "${k}" is not in the spec`);
      for (const k of schema.required ?? []) assert.ok(call.keys.includes(k), `${p} ${call.status}: required "${k}" is never sent`);
    }
    const sent = new Set(calls.map((c) => c.status));
    for (const status of Object.keys(op.responses)) assert.ok(sent.has(status), `${p}: documents ${status} but never sends it`);
  }
});

// ── real bodies against the schemas ──────────────────────────────────────────

const origin = "https://connect.smartdrugdiscovery.org";

test("GET /api/providers bodies match ProvidersResponse", () => {
  const op = spec.paths["/api/providers"].get;
  for (const qs of ["", "capability=in-vivo", "capability=screening&limit=2", "q=protein", "q=zzzz"]) {
    const parsed = publicDataMod.parseProvidersQuery(new URLSearchParams(qs));
    assert.ok(parsed.ok, qs);
    if (!parsed.ok) continue;
    const body = publicDataMod.providersBody(getAllProviders(), parsed, origin);
    assert.deepEqual(validate(responseSchema(op, "200"), body), [], qs);
  }
  const limit = op.parameters.find((x: S) => x.name === "limit").schema;
  assert.equal(limit.maximum, publicDataMod.PROVIDERS_LIMIT_MAX);
  assert.equal(limit.default, publicDataMod.PROVIDERS_LIMIT_DEFAULT);
});

test("GET /api/sparc body matches SparcResponse", () => {
  const body = publicDataMod.sparcBody();
  assert.deepEqual(validate(responseSchema(spec.paths["/api/sparc"].get, "200"), body), []);
});

test("GET /api/podcast-search hits match PodcastHit", () => {
  const ep: SearchableEpisode = {
    id: "e1",
    slug: "kras-inhibitors",
    title: "KRAS inhibitors in the clinic",
    description: "A conversation about KRAS G12C drugs.",
    tags: ["oncology"],
    concepts: [{ title: "KRAS" }],
    transcript: "We talked about covalent KRAS inhibitors and resistance.",
    episode_number: 12,
    image_url: null,
  };
  const hits = searchEpisodes([ep], "kras");
  assert.ok(hits.length > 0);
  const body = { hits, failed: false };
  assert.deepEqual(validate(responseSchema(spec.paths["/api/podcast-search"].get, "200"), body), []);
});

test("the validator itself catches wrong shapes", () => {
  const schema = responseSchema(spec.paths["/api/sparc"].get, "200");
  assert.notDeepEqual(validate(schema, { tools: [] }), []);
  const body = publicDataMod.sparcBody();
  assert.notDeepEqual(validate(schema, { ...body, extra: 1 }), []);
  assert.notDeepEqual(validate(schema, { ...body, patents: [{ title: "x", year: "2020", note: "" }] }), []);
});
