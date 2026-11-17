"use server";

// Server Actions for SSO sign-in / logout / account deletion. Same pattern as
// app/collaborate/actions.ts and app/promote/actions.ts.
//
// WHY THIS FILE EXISTS
// lib/auth.ts is server-only (it reads cookies via next/headers), so a "use
// client" page cannot import it. These actions are the bridge: the pages call
// them, they call the seam. The result is the property we actually want —
// NO PAGE IMPORTS @supabase/*, and the Oracle/UAB SSO swap changes lib/auth.ts
// and, at most, the bodies here.
//
// Everything crossing this boundary is a plain serialisable object; a caller
// never sees a Supabase error object, only the friendly string lib/auth.ts
// already mapped.

import { headers } from "next/headers";
import {
  deleteAccount,
  signInWithSSO,
  signOut,
  ServerConfigError,
  UnauthorizedError,
  type AuthOutcome,
  type SSORedirectOutcome,
} from "@/lib/auth";
import { postLoginPath } from "@/lib/safeRedirect";

const CONFIG_ERROR = "Sign-in is not configured on this server.";

/** SSO — the only reachable sign-in path. Starts the SPARC Keycloak redirect
 *  and hands the caller the authorization URL to navigate to. `callbackUrl`
 *  is where the user lands AFTER /auth/callback completes the exchange. */
export async function ssoLoginAction(callbackUrl: string): Promise<SSORedirectOutcome> {
  const origin = await requestOrigin();
  if (!origin) return { ok: false, error: "Couldn't determine this site's URL." };

  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(callbackUrl)}`;

  try {
    return await signInWithSSO(redirectTo);
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("ssoLoginAction failed", e);
    return { ok: false, error: "Couldn't start sign-in. Please try again." };
  }
}

/** "Sign in with a different email": end the current session, then start SSO
 *  again with a forced login form, returning to `callbackUrl` (the same page). */
export async function switchAccountAction(callbackUrl: string): Promise<SSORedirectOutcome> {
  const origin = await requestOrigin();
  if (!origin) return { ok: false, error: "Couldn't determine this site's URL." };
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(postLoginPath(callbackUrl))}`;
  try {
    await signOut();
    return await signInWithSSO(redirectTo, { forceLogin: true });
  } catch (e) {
    if (e instanceof ServerConfigError) return { ok: false, error: CONFIG_ERROR };
    console.error("switchAccountAction failed", e);
    return { ok: false, error: "Couldn't start sign-in. Please try again." };
  }
}

/** This deployment's origin, from the request. Emailed links must point back at
 *  the host the user is actually on, so it is never hardcoded or client-supplied. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  return (
    h.get("origin") ??
    (h.get("host") ? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` : "")
  );
}

export async function logoutAction(): Promise<void> {
  try {
    await signOut();
  } catch (e) {
    // Signing out must never leave the user stuck on a page that still looks
    // signed in — the caller navigates regardless of what happened here.
    console.error("logoutAction failed", e);
  }
}

// ── account deletion ─────────────────────────────────────────────────────────

/** Thin pass-through. ALL deletion logic lives in lib/auth.ts deleteAccount() —
 *  deliberately, so the Oracle rewrite has exactly one target. Do not add row
 *  cleanup here. */
export async function deleteAccountAction(formData: FormData): Promise<AuthOutcome> {
  const confirmEmail = String(formData.get("confirmEmail") ?? "");
  if (!confirmEmail.trim()) {
    return { ok: false, error: "Type your email address to confirm." };
  }

  try {
    return await deleteAccount(confirmEmail);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, error: "Sign in first." };
    if (e instanceof ServerConfigError) {
      return { ok: false, error: "Account deletion is not configured on this server." };
    }
    console.error("deleteAccountAction failed", e);
    return { ok: false, error: "Couldn't delete your account. Please try again." };
  }
}
