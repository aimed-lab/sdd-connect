// lib/server/nav/publicPages.ts — the pages anyone can open signed out, for
// app/sitemap.ts, and the paths app/robots.ts asks crawlers to skip. Pure: no
// runtime imports, so `npm test` covers it.
//
// Never list a page that sends a signed-out visitor to /login (sideMenu.ts's
// "My work" pages, /settings, /inbox, CollaboFest 2026): the test checks each
// page here for that redirect.

export const PUBLIC_PAGES: string[] = [
  "/",
  "/explore",
  "/explore/podcast",
  "/collaborate",
  "/collaborate/providers",
  "/promote",
  "/communities",
  "/events",
  "/sparc",
  "/phgdh",
  "/about",
  "/contact",
];

export const CRAWL_DISALLOW: string[] = ["/api/", "/auth/", "/settings", "/inbox", "/saved", "/onboarding"];

/** The site address without a trailing slash, joined to a path. */
export function absoluteUrl(site: string, path: string): string {
  const base = site.replace(/\/+$/, "");
  return path === "/" ? `${base}/` : `${base}${path}`;
}
