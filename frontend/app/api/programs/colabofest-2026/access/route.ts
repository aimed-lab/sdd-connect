import { NextResponse } from "next/server";
import { hasProgramAccess } from "@/lib/server/projectWorkspace/program";

// GET /api/programs/colabofest-2026/access -> { access } — whether the side menu
// links the CollaboFest dashboard. True only for a lead or manager of a
// CollaboFest project, decided from the session cookie. Signed out or on any
// error: false. The page itself checks again and 404s for everyone else.
//
// no-store: the answer is per-user, so a shared copy would leak it.

export const dynamic = "force-dynamic";

export async function GET() {
  let access = false;
  try {
    access = await hasProgramAccess();
  } catch (e) {
    console.error("program access check failed", e);
  }
  return NextResponse.json({ access }, { headers: { "Cache-Control": "no-store" } });
}
