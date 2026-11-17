import { NextResponse } from "next/server";

// GET /auth/confirm — retired 2026-11-17.
//
// This used to complete password-recovery links. Email/password auth is gone
// (SSO only), so any old link just lands on /login. The SSO return leg is
// /auth/callback.

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
