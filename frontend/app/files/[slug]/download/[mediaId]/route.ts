// GET /files/<slug>/download/<mediaId> — the permanent download link for one
// file attached to a PUBLISHED item (a file share or a Promote post). The
// older /promote/<slug>/files/<mediaId> redirects here, so links already sent
// keep working.
//
// The bucket is private, so there is no stable storage URL to share. This
// route is the stable address: on every click it looks the item and the file
// up through the ANON client (so only published items resolve), checks the
// file belongs to that item, mints a 60-second signed URL that downloads
// under the original filename, and redirects to it.
//
// 404 for an unknown slug, a draft, an unknown file, a file of another item,
// or an image (article images are shown inline, not served here). Never
// cached, by the browser or any CDN: a cached redirect would point at a
// signed URL that stops working a minute later.

import { NextResponse } from "next/server";
import { getPublishedFileDownloadUrl } from "@/lib/server/showcase";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; mediaId: string }> }
) {
  const { slug, mediaId } = await params;

  let url: string | null = null;
  try {
    url = await getPublishedFileDownloadUrl(slug, mediaId);
  } catch (e) {
    console.error("promote file download failed", e);
    return new NextResponse("Download is not available right now.", { status: 503, headers: NO_STORE });
  }

  if (!url) return new NextResponse("Not found.", { status: 404, headers: NO_STORE });

  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return res;
}
