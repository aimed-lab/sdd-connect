// GET /promote/<slug>/files/<mediaId> — the OLD permanent download address.
//
// Downloads now live at /files/<slug>/download/<mediaId> (app/files/[slug]/
// download/[mediaId]/route.ts), which applies every rule: published only,
// 60-second signed link, original filename, 404 for images and anything that
// does not match. This route only forwards there, so links already sent keep
// working. It checks nothing itself and is never cached.

import { NextResponse } from "next/server";
import { fileDownloadHref } from "@/lib/server/promote/mediaFiles";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> }
) {
  const { slug, mediaId } = await params;
  const res = NextResponse.redirect(new URL(fileDownloadHref(slug, mediaId), req.url), 307);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
