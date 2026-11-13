// A shared file's 1200x630 link preview card, at /files/<slug>/opengraph-image.
// The same card as /promote/<slug>/opengraph-image (lib/server/promote/
// cardImage.tsx draws it from the published item); this route only exists so
// a file share's og:image, twitter:image and "Download visual card" sit under
// its own /files address.

import { renderCard } from "@/lib/server/promote/cardImage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // reads the font from disk
export const maxDuration = 15;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return renderCard(slug);
}
