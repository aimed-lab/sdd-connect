// /reset-password — retired 2026-11-17.
//
// Sign-in is SSO-only (SPARC Keycloak), so there is no local password to
// reset. Old links forward to /login; password help lives at
// auth.smartdrugdiscovery.org.

import { redirect } from "next/navigation";

export default function ResetPasswordPage() {
  redirect("/login");
}
