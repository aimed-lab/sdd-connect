import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/lib/server/openapi";

// GET /api/openapi.json — the OpenAPI 3.1 description of the public read
// endpoints (lib/server/openapi.ts). Static: it describes the API, not data.

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(OPENAPI_SPEC);
}
