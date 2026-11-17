// /sitemap.xml — public pages only (lib/server/nav/publicPages.ts).

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/articleFormat";
import { PUBLIC_PAGES, absoluteUrl } from "@/lib/server/nav/publicPages";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: absoluteUrl(SITE_URL, path) }));
}
