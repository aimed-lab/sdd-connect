// /robots.txt — crawl everything public, skip the API and signed-in-only pages,
// and point at the sitemap.

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/articleFormat";
import { CRAWL_DISALLOW, absoluteUrl } from "@/lib/server/nav/publicPages";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: CRAWL_DISALLOW },
    sitemap: absoluteUrl(SITE_URL, "/sitemap.xml"),
  };
}
