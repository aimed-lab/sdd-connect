// The OpenAPI 3.1 description of the public read endpoints, served as is at
// GET /api/openapi.json and listed on /developers. It documents the routes as
// they behave today (including the 200-with-error:true responses); limits are
// read from the same constants the routes use. openapi.test.ts checks this
// against the route handlers, so a route change that is not reflected here
// fails the tests. Pure: no next/* imports.

import { ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS } from "./rateLimit.ts";
import {
  EXPLORE_BODY_MAX_CHARS,
  EXPLORE_MAX_PER_WINDOW,
  PAPERS_LIMIT_DEFAULT,
  PAPERS_LIMIT_MAX,
  PAPERS_LIMIT_MIN,
  PAPERS_MAX_PER_WINDOW,
  SEARCH_TEXT_MAX,
  SEARCH_WINDOW_MS,
} from "./searchRequest.ts";
import {
  PROVIDERS_LIMIT_DEFAULT,
  PROVIDERS_LIMIT_MAX,
  PROVIDERS_LIMIT_MIN,
  PROVIDERS_MAX_PER_WINDOW,
  SPARC_MAX_PER_WINDOW,
} from "./publicData.ts";
import { CAPABILITIES } from "./providers/capabilities.ts";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = { [k: string]: Json };

/** Limits as the routes apply them: the in-memory limiter counts requests per
 *  IP address on one server instance, so it is best effort, not a quota. */
function rateLimit(requests: number, windowMs: number): Schema {
  return { requests, window_seconds: windowMs / 1000, per: "IP address, per server instance (best effort)" };
}

/** Value a route quietly cuts the text to (it does not reject longer text). */
export const PODCAST_QUERY_TRUNCATE = 120;
export const COMMUNITY_MATCH_QUERY_TRUNCATE = 200;
export const COMMUNITY_MATCH_QUERY_MIN = 3;
export const PODCAST_HITS_MAX = 60;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Schema, description: string, headers?: Schema): Schema => ({
  description,
  ...(headers ? { headers } : {}),
  content: { "application/json": { schema } },
});
const retryAfter: Schema = {
  "Retry-After": { description: "Seconds to wait before trying again.", schema: { type: "string" } },
};
const nullable = (type: string): Schema => ({ type: [type, "null"] });

const schemas: Record<string, Schema> = {
  Signal: {
    type: "object",
    required: ["metric", "value", "as_of"],
    properties: {
      metric: { type: "string", description: "citations, stars or recency" },
      value: { type: "number" },
      as_of: { type: "string" },
    },
  },
  ExploreItem: {
    type: "object",
    description: "One result from the explore backend.",
    required: ["id", "kind", "title", "source"],
    properties: {
      id: { type: "string" },
      kind: {
        type: "string",
        description:
          "paper, preprint, news, trial, approval, grant, tool, dataset, geneset, compound, target, resource, person or episode",
      },
      title: { type: "string" },
      summary: nullable("string"),
      url: nullable("string"),
      doi: nullable("string"),
      source: { type: "string" },
      date_iso: nullable("string"),
      signal: { oneOf: [ref("Signal"), { type: "null" }] },
      dedupe_key: { type: "string" },
      raw: { type: "object", description: "Source-specific fields; shape varies by kind." },
    },
  },
  ExploreSection: {
    type: "object",
    required: ["tool", "kind", "items"],
    properties: {
      tool: { type: "string" },
      kind: { type: "string" },
      query: { type: "string" },
      items: { type: "array", items: ref("ExploreItem") },
      items_key: {
        type: "array",
        items: ref("ExploreItem"),
        description: "Papers section only: the same items re-ranked as key papers.",
      },
      error: { type: "string" },
    },
  },
  PapersResponse: {
    type: "object",
    required: ["items"],
    properties: {
      query: { type: "string" },
      items: { type: "array", items: ref("ExploreItem") },
      error: { type: "boolean", description: "true (with HTTP 200 and no items) when the literature backend failed." },
      rate_limited: { type: "boolean" },
      message: { type: "string" },
    },
  },
  ExploreRequest: {
    type: "object",
    properties: {
      input: { type: "string", maxLength: SEARCH_TEXT_MAX, description: "Search text. Blank returns the landing feed." },
      personalize: { type: "boolean", default: true, description: "Signed-in only: scope the blank feed to saved interests." },
      project_id: { type: "string", maxLength: 64 },
      since_year: { type: "number" },
      status_filter: {
        type: "array",
        items: { type: "string", maxLength: 64 },
        description: "Trial statuses. Only the first 20 non-blank items are used; longer items are dropped.",
      },
      only_kinds: {
        type: "array",
        items: { type: "string", maxLength: 64 },
        description: "Query just these source kinds (e.g. grant). Only the first 20 are used.",
      },
    },
  },
  ExploreResponse: {
    type: "object",
    required: ["sections"],
    properties: {
      input: { type: "string" },
      scope: { type: "object", description: "The structured scope the backend extracted or used." },
      tools_called: { type: "array", items: { type: "string" } },
      reasoning: nullable("string"),
      sections: { type: "array", items: ref("ExploreSection") },
      error: { type: "boolean", description: "true (with HTTP 200 and no sections) when the backend failed." },
      rate_limited: { type: "boolean" },
      message: { type: "string" },
    },
  },
  PodcastHit: {
    type: "object",
    required: ["id", "slug", "title", "episode_number", "image_url", "description", "tags", "field", "snippet", "score"],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      title: { type: "string" },
      episode_number: nullable("integer"),
      image_url: nullable("string"),
      description: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      field: { type: "string", enum: ["episode", "title", "description", "topics", "transcript"] },
      snippet: {
        oneOf: [
          {
            type: "object",
            required: ["text", "field"],
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              field: { type: "string", enum: ["episode", "title", "description", "topics", "transcript"] },
            },
          },
          { type: "null" },
        ],
      },
      score: { type: "number" },
    },
  },
  PodcastSearchResponse: {
    type: "object",
    required: ["hits", "failed"],
    properties: {
      hits: { type: "array", items: ref("PodcastHit"), maxItems: PODCAST_HITS_MAX },
      failed: { type: "boolean", description: "true when the episode index could not be read, or when rate limited." },
    },
  },
  ExploreStatsResponse: {
    type: "object",
    required: ["episodes"],
    properties: { episodes: { ...nullable("integer"), description: "Number of podcast episodes; null when the read failed." } },
  },
  CommunityMatch: {
    type: "object",
    required: ["id", "slug", "name", "purpose", "memberCount", "isOpen", "runBy", "why", "state"],
    additionalProperties: false,
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      name: { type: "string" },
      purpose: nullable("string"),
      memberCount: { type: "integer" },
      isOpen: { type: "boolean" },
      runBy: { ...nullable("string"), description: "The admin's name, only when the viewer may see the roster." },
      why: { type: "array", items: { type: "string" } },
      state: { type: "string", enum: ["signed_out", "none", "pending", "active"] },
    },
  },
  CommunityMatchResponse: {
    type: "object",
    properties: {
      signedIn: { type: "boolean" },
      matches: { type: "array", items: ref("CommunityMatch") },
      error: { type: "string", description: "Only on HTTP 429." },
    },
  },
  Community: {
    type: "object",
    required: ["id", "slug", "kind", "name"],
    properties: {
      id: { type: "string" },
      slug: { type: "string" },
      kind: { type: "string", enum: ["community", "team"] },
      name: { type: "string" },
      description: nullable("string"),
      is_open: { type: "boolean" },
      sections: { type: ["array", "null"], items: { type: "object" } },
      explore_sources: { type: "array", items: { type: "string" } },
      explore_topics: { type: "array", items: { type: "string" } },
      explore_refreshed_at: nullable("string"),
      explore_paper_scope: { type: "string", enum: ["all", "clinical"] },
      explore_grant_activity_codes: { type: "array", items: { type: "string" } },
      public_preview: { type: "string" },
      member_count: { type: "integer" },
    },
  },
  CommunitySummaryResponse: {
    type: "object",
    required: ["signedIn", "communities"],
    properties: {
      signedIn: { type: "boolean" },
      communities: {
        type: "array",
        items: {
          type: "object",
          required: ["community", "member", "role", "pending"],
          properties: {
            community: ref("Community"),
            member: { type: "boolean" },
            role: { type: ["string", "null"], enum: ["admin", "lead", "member", null] },
            pending: { type: "boolean" },
          },
        },
      },
    },
  },
  KeyFact: {
    type: "object",
    required: ["value", "label"],
    additionalProperties: false,
    properties: { value: { type: "string" }, label: { type: "string" } },
  },
  Provider: {
    type: "object",
    description: "A provider record. Never includes contact details (email, phone or website).",
    required: [
      "slug",
      "name",
      "category",
      "category_label",
      "capabilities",
      "services",
      "description",
      "location",
      "event",
      "key_facts",
      "profile_url",
    ],
    additionalProperties: false,
    properties: {
      slug: { type: "string" },
      name: { type: "string" },
      category: { type: "string" },
      category_label: { type: "string" },
      capabilities: { type: "array", items: { type: "string", enum: CAPABILITIES.map((c) => c.id) } },
      services: { type: "array", items: { type: "string" } },
      description: { type: "string" },
      location: { type: "string" },
      event: { type: "string" },
      key_facts: { type: "array", items: ref("KeyFact") },
      profile_url: { type: "string", format: "uri" },
    },
  },
  ProvidersResponse: {
    type: "object",
    required: ["source", "total", "count", "query", "capabilities", "providers"],
    additionalProperties: false,
    properties: {
      source: { type: "string" },
      total: { type: "integer", description: "Providers in the directory." },
      count: { type: "integer", description: "Providers in this response." },
      query: {
        type: "object",
        required: ["q", "capability", "limit"],
        additionalProperties: false,
        properties: { q: { type: "string" }, capability: nullable("string"), limit: { type: "integer" } },
      },
      capabilities: {
        type: "array",
        description: "Capabilities at least one provider has, with counts over the whole directory.",
        items: {
          type: "object",
          required: ["id", "label", "count"],
          additionalProperties: false,
          properties: { id: { type: "string" }, label: { type: "string" }, count: { type: "integer" } },
        },
      },
      providers: { type: "array", items: ref("Provider") },
    },
  },
  SparcResponse: {
    type: "object",
    required: ["source", "tools", "papers", "patents"],
    additionalProperties: false,
    properties: {
      source: {
        type: "object",
        required: ["software", "publications"],
        additionalProperties: false,
        properties: { software: { type: "string" }, publications: { type: "string" } },
      },
      tools: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "category", "one_line", "links"],
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            one_line: { type: "string" },
            links: {
              type: "array",
              items: {
                type: "object",
                required: ["label", "href"],
                additionalProperties: false,
                properties: { label: { type: "string", enum: ["GitHub", "Paper", "Launch"] }, href: { type: "string" } },
              },
            },
          },
        },
      },
      papers: {
        type: "array",
        description: "Newest year first.",
        items: {
          type: "object",
          required: ["title", "venue", "year", "doi", "url"],
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            venue: { type: "string" },
            year: { type: "integer" },
            doi: { type: "string" },
            url: { type: "string" },
          },
        },
      },
      patents: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "year", "note"],
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            year: { type: "integer" },
            note: { type: "string" },
            number: { type: "string", description: "Present only when SPARC staff have supplied it." },
            status: { type: "string", description: "Present only when supplied." },
            url: { type: "string", description: "Present only when supplied." },
            licensing_contact: { type: "string", description: "Present only when supplied." },
          },
        },
      },
    },
  },
  ErrorMessage: {
    type: "object",
    required: ["error", "message"],
    properties: {
      error: { type: "boolean", const: true },
      rate_limited: { type: "boolean" },
      message: { type: "string" },
      items: { type: "array", maxItems: 0 },
      query: { type: "string" },
      sections: { type: "array", maxItems: 0 },
      scope: { type: "object" },
      providers: { type: "array", maxItems: 0 },
    },
  },
};

const tooMany = (headers = true): Schema =>
  json(ref("ErrorMessage"), "Too many requests from this IP address.", headers ? retryAfter : undefined);

const paths: Record<string, Schema> = {
  "/api/papers": {
    get: {
      operationId: "searchPapers",
      summary: "Live literature search (PubMed, OpenAlex, Crossref).",
      "x-rate-limit": rateLimit(PAPERS_MAX_PER_WINDOW, SEARCH_WINDOW_MS),
      parameters: [
        { name: "q", in: "query", schema: { type: "string", maxLength: SEARCH_TEXT_MAX }, description: "Blank returns no items." },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: PAPERS_LIMIT_MIN, maximum: PAPERS_LIMIT_MAX, default: PAPERS_LIMIT_DEFAULT },
          description: "Out-of-range values are clamped; a non-number is a 400.",
        },
      ],
      responses: {
        "200": json(ref("PapersResponse"), "Results. A backend failure is also a 200, with error: true and no items."),
        "400": json(ref("ErrorMessage"), "q is too long or limit is not a number."),
        "429": json(ref("PapersResponse"), "Too many requests from this IP address.", retryAfter),
      },
    },
  },
  "/api/explore": {
    post: {
      operationId: "explore",
      summary: "Explore search across papers, preprints, trials, approvals, grants, datasets, gene sets, targets and news.",
      "x-rate-limit": rateLimit(EXPLORE_MAX_PER_WINDOW, SEARCH_WINDOW_MS),
      "x-max-body-bytes": EXPLORE_BODY_MAX_CHARS,
      requestBody: { required: false, content: { "application/json": { schema: ref("ExploreRequest") } } },
      responses: {
        "200": json(ref("ExploreResponse"), "Sections of results. A backend failure is also a 200, with error: true and no sections."),
        "400": json(ref("ErrorMessage"), "The body or a field is too large."),
        "429": json(ref("ExploreResponse"), "Too many requests from this IP address.", retryAfter),
      },
    },
  },
  "/api/podcast-search": {
    get: {
      operationId: "searchPodcast",
      summary: "Search podcast episode titles, descriptions, topics and transcripts.",
      "x-rate-limit": rateLimit(ASSISTANT_MAX_REQUESTS * 8, ASSISTANT_WINDOW_MS),
      parameters: [
        {
          name: "q",
          in: "query",
          schema: { type: "string" },
          "x-truncate-at": PODCAST_QUERY_TRUNCATE,
          description: `Trimmed and cut to ${PODCAST_QUERY_TRUNCATE} characters. Blank returns no hits.`,
        },
      ],
      responses: {
        "200": json(ref("PodcastSearchResponse"), "Up to 60 hits. failed: true when the index could not be read."),
        "429": json(ref("PodcastSearchResponse"), "Too many requests from this IP address (hits: [], failed: true)."),
      },
    },
  },
  "/api/explore-stats": {
    get: {
      operationId: "exploreStats",
      summary: "How many podcast episodes exist.",
      responses: { "200": json(ref("ExploreStatsResponse"), "episodes is null when the read failed.") },
    },
  },
  "/api/communities/match": {
    get: {
      operationId: "matchCommunities",
      summary: "The top existing communities for a topic.",
      "x-rate-limit": rateLimit(ASSISTANT_MAX_REQUESTS, ASSISTANT_WINDOW_MS),
      parameters: [
        {
          name: "q",
          in: "query",
          schema: { type: "string" },
          "x-truncate-at": COMMUNITY_MATCH_QUERY_TRUNCATE,
          description: `Trimmed and cut to ${COMMUNITY_MATCH_QUERY_TRUNCATE} characters; fewer than ${COMMUNITY_MATCH_QUERY_MIN} characters returns no matches.`,
        },
      ],
      responses: {
        "200": json(ref("CommunityMatchResponse"), "Matches. A failure is also a 200 with no matches."),
        "429": json(ref("CommunityMatchResponse"), 'Too many requests from this IP address ({ "error": "Too many requests." }).'),
      },
    },
  },
  "/api/communities-summary": {
    get: {
      operationId: "communitiesSummary",
      summary: "Communities, or those matching q, with the caller's membership state.",
      parameters: [{ name: "q", in: "query", schema: { type: "string" }, description: "Optional search text." }],
      responses: {
        "200": json(ref("CommunitySummaryResponse"), "Communities. A failure is also a 200 with an empty list."),
      },
    },
  },
  "/api/providers": {
    get: {
      operationId: "listProviders",
      summary: "The Service Providers directory (companies met at BioTechX Europe 2026). No contact details.",
      "x-rate-limit": rateLimit(PROVIDERS_MAX_PER_WINDOW, SEARCH_WINDOW_MS),
      parameters: [
        {
          name: "capability",
          in: "query",
          schema: { type: "string", enum: CAPABILITIES.map((c) => c.id) },
          description: "Only providers with this capability. Unknown values are a 400.",
        },
        {
          name: "q",
          in: "query",
          schema: { type: "string", maxLength: SEARCH_TEXT_MAX },
          description: "Every word must appear in the name, services, description or category (synonyms count).",
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: PROVIDERS_LIMIT_MIN, maximum: PROVIDERS_LIMIT_MAX, default: PROVIDERS_LIMIT_DEFAULT },
          description: "Out-of-range values are clamped; a non-number is a 400.",
        },
      ],
      responses: {
        "200": json(ref("ProvidersResponse"), "Matching providers."),
        "400": json(ref("ErrorMessage"), "Unknown capability, q too long or limit not a number."),
        "429": tooMany(),
      },
    },
  },
  "/api/sparc": {
    get: {
      operationId: "sparcResources",
      summary: "SPARC Center tools, papers and patents, as shown on /sparc.",
      "x-rate-limit": rateLimit(SPARC_MAX_PER_WINDOW, SEARCH_WINDOW_MS),
      responses: {
        "200": json(ref("SparcResponse"), "Tools, papers and patents."),
        "429": tooMany(),
      },
    },
  },
};

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "SmartDrugDiscovery Connect public read API",
    version: "1.0.0",
    description:
      "Read-only endpoints that need no sign-in. Responses are JSON. Limits are per IP address and best effort (x-rate-limit on each operation). Some routes report a backend failure as HTTP 200 with error: true (or failed: true) so the site can show an empty state; check that field as well as the status. The agent tools that act for a signed-in researcher are described separately at /api/agent/tools.",
  },
  servers: [{ url: "https://connect.smartdrugdiscovery.org" }],
  paths,
  components: { schemas },
} as const;

export type OpenApiSpec = typeof OPENAPI_SPEC;
