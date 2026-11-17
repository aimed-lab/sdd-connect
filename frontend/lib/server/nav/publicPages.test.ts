// Run with `npm test`. Sitemap and robots lists, the 404 page, page titles, the
// skip link, the Feedback button's size and the SPARC paper rows.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CRAWL_DISALLOW, PUBLIC_PAGES, absoluteUrl } from "./publicPages.ts";
import { MY_WORK } from "./sideMenu.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const pageFile = (path: string) => (path === "/" ? "app/page.tsx" : `app${path}/page.tsx`);

test("sitemap: every listed page exists and none sends a signed-out visitor to /login", () => {
  for (const path of PUBLIC_PAGES) {
    const file = pageFile(path);
    assert.ok(existsSync(new URL(file, root)), file);
    assert.doesNotMatch(read(file), /redirect\(\s*["'`]\/login/, path);
  }
  for (const signedInOnly of [...MY_WORK.map((i) => i.href), "/settings", "/inbox", "/onboarding", "/programs/colabofest-2026", "/login"]) {
    assert.ok(!PUBLIC_PAGES.includes(signedInOnly), signedInOnly);
  }
});

test("robots: skips the API and signed-in pages, never a public page", () => {
  assert.ok(CRAWL_DISALLOW.includes("/api/"));
  for (const path of PUBLIC_PAGES) {
    assert.ok(!CRAWL_DISALLOW.some((d) => path.startsWith(d)), path);
  }
});

test("absoluteUrl joins without doubled or missing slashes", () => {
  assert.equal(absoluteUrl("https://x.org/", "/"), "https://x.org/");
  assert.equal(absoluteUrl("https://x.org", "/events"), "https://x.org/events");
  assert.equal(absoluteUrl("https://x.org//", "/sitemap.xml"), "https://x.org/sitemap.xml");
});

test("security.txt: the GitHub advisory form, an expiry, no email address", () => {
  const txt = read("public/.well-known/security.txt");
  assert.match(txt, /^Contact: https:\/\/github\.com\/aimed-lab\/sdd-connect\/security\/advisories\/new$/m);
  const expires = txt.match(/^Expires: (.+)$/m);
  assert.ok(expires && !Number.isNaN(Date.parse(expires[1])));
  assert.doesNotMatch(txt, /@|mailto:/);
});

test("titles: one template in the root layout, no page repeats the site name", () => {
  for (const file of ["app/layout.tsx", "app/explore/layout.tsx"]) assert.match(read(file), /template: "%s · SmartDrugDiscovery"/, file);
  for (const file of ["app/about/page.tsx", "app/contact/page.tsx", "app/communities/page.tsx", "app/collaborate/providers/page.tsx", "app/communities/[slug]/page.tsx", "app/not-found.tsx"]) {
    assert.doesNotMatch(read(file), /title:[^\n]*SmartDrugDiscovery/, file);
  }
  for (const file of ["app/login/layout.tsx", "app/collaborate/page.tsx", "app/promote/page.tsx", "app/events/page.tsx", "app/sparc/page.tsx"]) {
    assert.match(read(file), /export const metadata = \{ title: "[^"]+" \}/, file);
  }
});

test("404: a styled page with links home and to Explore", () => {
  const page = read("app/not-found.tsx");
  assert.match(page, /href="\/"/);
  assert.match(page, /href="\/explore"/);
  assert.match(page, /PageHeader title="Page not found"/);
});

test("skip link: first in the body, to the main element", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /<a\s+href="#main-content"[\s\S]*?Skip to content/);
  assert.match(layout, /<main id="main-content"/);
  assert.ok(layout.indexOf("#main-content") < layout.indexOf("<Nav />"));
});

test("Feedback button: at least 44px on a phone", () => {
  const src = read("components/feedback/GeneralFeedback.tsx");
  assert.match(src, /max-sm:!h-11 max-sm:!w-11/);
  assert.doesNotMatch(src, /max-sm:!h-10|max-sm:!w-10/);
});

test("Explore and Sign in have an h1 before the client part loads", () => {
  assert.match(read("app/explore/page.tsx"), /fallback=\{[\s\S]*?<h1 className="sr-only">Explore<\/h1>/);
  assert.match(read("app/login/page.tsx"), /fallback=\{[\s\S]*?<LoginHeader \/>/);
});

test("Events is in the top nav", () => {
  assert.match(read("components/Nav.tsx"), /\{ label: "Events", href: "\/events" \}/);
});

test("SPARC papers write venue and year once per row", () => {
  const src = read("components/sparc/SparcPapers.tsx");
  assert.equal(src.match(/\{meta\}/g)?.length, 1);
  assert.doesNotMatch(src, /import PaperList/);
});
