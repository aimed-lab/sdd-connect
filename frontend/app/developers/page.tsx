// /developers — a short page for people who want the site's data in a script:
// the public read endpoints, their limits, and a link to the OpenAPI spec.
// Rendered from lib/server/openapi.ts so the list cannot drift from the spec.

import type { Metadata } from "next";
import PageHeader, { PageShell } from "@/components/PageHeader";
import { OPENAPI_SPEC } from "@/lib/server/openapi";

export const metadata: Metadata = {
  title: "Developer API | SmartDrugDiscovery",
  description: "Public read-only JSON endpoints for SmartDrugDiscovery Connect, with an OpenAPI 3.1 spec.",
};

type Operation = { summary?: string; "x-rate-limit"?: { requests: number; window_seconds: number } };

function limitText(op: Operation): string {
  const l = op["x-rate-limit"];
  if (!l) return "No request limit";
  const minutes = l.window_seconds / 60;
  const window = minutes === 1 ? "minute" : Number.isInteger(minutes) ? `${minutes} minutes` : `${l.window_seconds} seconds`;
  return `${l.requests} requests per ${window} per IP`;
}

const LINK = "text-primary hover:underline underline-offset-4";

export default function DevelopersPage() {
  const rows = Object.entries(OPENAPI_SPEC.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Operation>).map(([method, op]) => ({ path, method: method.toUpperCase(), op }))
  );

  return (
    <PageShell>
      <PageHeader
        title="Developer API"
        subtitle="Read-only JSON endpoints that need no sign-in: literature and Explore search, the podcast, communities, service providers and SPARC Center resources."
      />

      <div className="max-w-3xl space-y-4 font-body-md text-body-md text-on-background">
        <p>
          The full description, with parameters, response shapes and limits, is the OpenAPI 3.1 spec at{" "}
          <a href="/api/openapi.json" className={LINK}>
            /api/openapi.json
          </a>
          . Load it into any OpenAPI tool to browse it or generate a client.
        </p>
        <p className="text-secondary">
          Limits are counted per IP address and are best effort. A 429 means wait and try again (most say how long in
          a Retry-After header). Some endpoints report a backend failure as HTTP 200 with <code>error: true</code> (or{" "}
          <code>failed: true</code>), so check that field as well as the status.
        </p>
        <p className="text-secondary">
          The agent tools that act for a signed-in researcher are listed separately at{" "}
          <a href="/api/agent/tools" className={LINK}>
            /api/agent/tools
          </a>
          .
        </p>
      </div>

      <ul className="mt-10 max-w-3xl divide-y divide-[#e7e4dc] border-y border-[#e7e4dc]">
        {rows.map(({ path, method, op }) => (
          <li key={`${method} ${path}`} className="py-3.5">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-label-md text-label-md text-secondary w-12">{method}</span>
              <code className="text-[15px] text-on-background">{path}</code>
            </p>
            {op.summary && <p className="mt-1 text-[14px] leading-5 text-on-background">{op.summary}</p>}
            <p className="text-[13px] leading-5 text-secondary">{limitText(op)}</p>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
