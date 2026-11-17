// =============================================================================
// lib/auth.ts — THE AUTH SEAM.
// =============================================================================
// Every feature module AND every auth page gets its identity through this file
// and NEVER imports @supabase/* directly. That is the whole point of the file:
// it is the single place that knows Supabase is the identity provider.
//
// Two groups of exports:
//   • READS    — getCurrentUser / getSession / requireCurrentUser / getDb.
//                Used by lib/server/* and server components to answer "who is
//                this and what may they touch".
//   • SESSION  — signInWithSSO / signOut / confirmEmailLink.
//                Used ONLY by app/auth/actions.ts, which the login and signup
//                pages call. No page imports this module directly (it is
//                server-only) and no page imports Supabase.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ SPARC SSO — LIVE. Supabase Auth is still the session layer; it now         │
// │ federates identity to the lab's Keycloak (issuer                          │
// │ auth.smartdrugdiscovery.org/realms/sdd) via a custom OIDC provider         │
// │ registered in Supabase as `custom:sdd`. signInWithSSO() below starts that  │
// │ redirect. auth.uid() and every RLS policy / SECURITY DEFINER function are  │
// │ untouched — they were never coupled to *how* the session got established. │
// │                                                                           │
// │ Email/password sign-in, sign-up and password reset were REMOVED on         │
// │ 2026-11-17 (security advisory GHSA-6g2g-qm7q-f8f5): the Supabase Email     │
// │ provider is off and SSO is the only sign-in path. Do not reintroduce a     │
// │ local password flow — see the SmartDrugDiscovery Authentication Guide.     │
// │                                                                           │
// │ A FUTURE swap off Supabase Auth entirely still only touches this file:     │
// │ callers depend on the AuthUser / AuthOutcome shapes and on                 │
// │ requireCurrentUser() throwing UnauthorizedError, not on Supabase. The one  │
// │ thing a replacement MUST preserve: `getDb()` returns a client that carries │
// │ the caller's identity, because Postgres RLS (auth.uid() = ...) is the      │
// │ real enforcement layer. If a new provider can't produce a request-scoped   │
// │ DB identity, the RLS policies in database/schema.sql need revisiting at    │
// │ the same time — they are not app-level checks that can be swapped          │
// │ independently.                                                            │
// └───────────────────────────────────────────────────────────────────────────┘

import {
  ServerConfigError,
  UnauthorizedError,
  getServiceRoleClient,
  getSessionClient,
} from "@/lib/server/supabaseServer";

// Re-exported so callers can catch/handle these without reaching past this file.
export { ServerConfigError, UnauthorizedError };

/** The provider-agnostic identity shape the app codes against. */
export type AuthUser = {
  id: string;
  email: string | null;
};

/** Result of an auth operation. `ok: true` always means "done, and the session
 *  cookies now reflect it" — there is no intermediate "pending confirmation"
 *  state for a caller to handle.
 *
 *  (This previously carried a `needsEmailConfirmation` flag. Email confirmation
 *  was removed from signup, so every success is now immediate.) */
export type AuthOutcome = { ok: true } | { ok: false; error: string };

/** Result of starting an SSO redirect — carries the IdP authorization URL the
 *  caller must navigate the browser to, since signInWithOAuth() cannot do
 *  that itself from server-side code (only the browser SDK auto-redirects). */
export type SSORedirectOutcome = { ok: true; url: string } | { ok: false; error: string };

/** Supabase's raw auth errors are either too technical or too revealing to show
 *  a user verbatim. This is the ONE place that translation happens, so swapping
 *  providers doesn't scatter new message-matching through the pages.
 *
 *  Deliberately does NOT distinguish "no such account" from "wrong password":
 *  that difference is a user-enumeration oracle. */
function friendlyAuthError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email or password isn't right.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email first — check your inbox for the link.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with that email already exists. Try logging in.";
  }
  if (m.includes("password should be") || m.includes("password is too short")) {
    return "Passwords need to be at least 8 characters.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  // Supabase rejects some domains outright (reserved TLDs like .invalid/.test,
  // and anything its deliverability check dislikes), reported as
  // error_code "email_address_invalid".
  if (
    m.includes("unable to validate email") ||
    m.includes("invalid email") ||
    (m.includes("email address") && m.includes("invalid"))
  ) {
    return "That email address isn't accepted. Try a different one.";
  }
  // Deliberately neutral: this mapper is shared by sign-in AND sign-up, so it
  // must not assert which one the user was doing.
  return "Something went wrong. Please try again.";
}

/** The current user, or null when signed out. Never throws for "signed out" —
 *  use this for gating UI (show "Sign in to post" instead of a form). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await getSessionClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** The current session's user plus the identity-carrying DB client, or null.
 *  Prefer requireCurrentUser() for writes. */
export async function getSession(): Promise<{ user: AuthUser; db: Db } | null> {
  const supabase = await getSessionClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    db: supabase as Db,
  };
}

/** Like getCurrentUser() but THROWS UnauthorizedError when signed out. The
 *  gateway for every write: the uid comes from the validated session here, never
 *  from a request body.
 *
 *  THE single place every lib/server/* write goes through — this used to
 *  delegate to a `requireUser()` in lib/server/supabaseServer.ts, which made
 *  that file a second, independent call site for `supabase.auth.getUser()`.
 *  Owning the call here instead means a provider swap only ever touches this
 *  file, not supabaseServer.ts too — see the SWAP POINT box above. */
export async function requireCurrentUser(): Promise<{ user: AuthUser; db: Db }> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();

  return { user: { id: user.id, email: user.email ?? null }, db: supabase as Db };
}

// ── auth OPERATIONS (sign in / sign up / sign out) ───────────────────────────
//
// These run SERVER-SIDE, from Server Actions and Route Handlers, for two
// reasons that both matter for Monday:
//
//   1. The session lands in httpOnly-capable cookies written by the same client
//      getDb()/requireCurrentUser() read, so server components, RLS and the
//      pages agree about who you are the moment the action returns.
//   2. SSO is a REDIRECT flow. An IdP hand-off cannot be driven from a browser
//      SDK call, so putting these on the server now means the swap replaces the
//      bodies of these functions and touches no page at all.
//
// Pages never call these directly (they can't — this module is server-only).
// They go through app/auth/actions.ts, which is the only caller.

// ── SSO (SPARC Keycloak, `custom:sdd`) ───────────────────────────────────────
//
// Supabase Auth stays the SESSION layer — it federates identity to Keycloak
// via a registered custom OIDC provider, but auth.uid() and the session
// cookies work exactly as before. Nothing in RLS or any SECURITY DEFINER
// function changes for this; they were never coupled to *how* the session
// was established, only to Supabase Auth issuing it.

/** Begin the SPARC SSO sign-in redirect. Returns the Keycloak authorization
 *  URL for the caller to navigate the browser to. `redirectTo` must be this
 *  app's own /auth/callback route (with `?next=` already appended) — Keycloak
 *  and Supabase both need to land back on our origin before the final
 *  destination redirect happens. */
export async function signInWithSSO(
  redirectTo: string,
  opts: { forceLogin?: boolean } = {}
): Promise<SSORedirectOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  const { data, error } = await supabase.auth.signInWithOAuth({
    // Supabase's `Provider` union predates custom OIDC providers — `custom:sdd`
    // is a real, dashboard-registered identifier the API accepts at runtime,
    // just not one the SDK's own type knows about yet.
    provider: "custom:sdd" as unknown as Parameters<
      typeof supabase.auth.signInWithOAuth
    >[0]["provider"],
    // forceLogin asks Keycloak to show its login form even when it still has a
    // session, which is what "sign in with a different email" needs.
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      ...(opts.forceLogin ? { queryParams: { prompt: "login" } } : {}),
    },
  });

  if (error || !data?.url) {
    return { ok: false, error: friendlyAuthError(error?.message ?? "") };
  }
  return { ok: true, url: data.url };
}

/** Sign out and clear the session cookies. */
export async function signOut(): Promise<void> {
  const supabase = await getSessionClient();
  if (!supabase) return; // already effectively signed out
  await supabase.auth.signOut();
}

/** Finish a PKCE code exchange — used by the SSO return leg (/auth/callback).
 *  The token-hash branch is kept for Supabase-issued links (e.g. an admin
 *  magic link), not for any password flow. */
export async function confirmEmailLink(params: {
  code?: string | null;
  tokenHash?: string | null;
  type?: string | null;
}): Promise<AuthOutcome> {
  const supabase = await getSessionClient();
  if (!supabase) throw new ServerConfigError();

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  }

  if (params.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      // "recovery" is the password-reset link; "signup"/"email" are confirmations.
      type: (params.type as "signup" | "email" | "recovery") ?? "signup",
    });
    if (error) return { ok: false, error: friendlyAuthError(error.message) };
    return { ok: true };
  }

  return { ok: false, error: "That confirmation link is incomplete." };
}

// ── account deletion ─────────────────────────────────────────────────────────

/**
 * Permanently delete the caller's account and everything they own.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ MIGRATION POINT — this function is the most Supabase-specific code in   │
 * │ the app and WILL need rewriting for Oracle.                             │
 * │                                                                         │
 * │ Two parts have to change together:                                      │
 * │   1. The identity delete (auth.admin.deleteUser) has no Oracle analogue.│
 * │      Under UAB SSO the institution owns the account — we will almost    │
 * │      certainly not be allowed to delete it at all, and this becomes     │
 * │      "delete the user's DATA and detach the identity" instead.          │
 * │   2. The row cascade below relies on Postgres FKs declared              │
 * │      ON DELETE CASCADE from auth.users. A different identity store      │
 * │      means those FKs no longer point anywhere, so the explicit deletes  │
 * │      here become the ONLY cleanup and must be exhaustive.               │
 * │                                                                         │
 * │ Everything is here on purpose. No page, action or route contains any    │
 * │ part of this cascade.                                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Confirmation is by typed email rather than password. That is deliberate:
 * under SSO there is no local password to re-verify, so a password prompt would
 * be one more thing to tear out. The typed value is compared to the SESSION's
 * email, server-side — a caller cannot nominate someone else's account.
 */
export async function deleteAccount(confirmEmail: string): Promise<AuthOutcome> {
  const { db: sessionDb, user } = await requireCurrentUser();

  const typed = confirmEmail.trim().toLowerCase();
  const actual = (user.email ?? "").trim().toLowerCase();
  if (!actual || typed !== actual) {
    return { ok: false, error: "That doesn't match the email on this account." };
  }

  const admin = getServiceRoleClient();
  if (!admin) throw new ServerConfigError("Account deletion is not configured.");

  const userId = user.id;

  // Explicit cascade. Most of these FKs are already ON DELETE CASCADE from
  // auth.users, so deleteUser alone would clear them — they are listed anyway so
  // the full blast radius is readable in one place, and so the cleanup still
  // works if a cascade is ever dropped or the identity store changes (see the
  // migration box above). Order: children before parents.
  const owned: Array<[table: string, column: string]> = [
    ["comments", "user_id"],
    ["researcher_works", "user_id"],
    ["saved_items", "user_id"],
    ["connection_requests", "user_id"],
    ["collab_posts", "owner_id"],
    ["promote_showcase", "owner_id"],
    ["lab_resources", "owner_id"],
    ["users", "id"],
  ];

  try {
    for (const [table, column] of owned) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) throw new Error(`auth user: ${authErr.message}`);
  } catch (e) {
    // Never leak raw Postgres/Supabase detail to the client.
    console.error("deleteAccount failed", e);
    return {
      ok: false,
      error: "Something went wrong deleting your account. Please contact support.",
    };
  }

  // Clear the now-orphaned session cookies so the browser isn't left holding a
  // token for a user that no longer exists.
  await sessionDb.auth.signOut().catch(() => {});

  return { ok: true };
}

/** A request-scoped DB client carrying the caller's identity (so RLS applies).
 *  Signed out, this is still valid — it just sees only what public policies
 *  allow, which is exactly what the public board read needs. */
export async function getDb(): Promise<Db | null> {
  const supabase = await getSessionClient();
  return (supabase as Db) ?? null;
}

// The DB client type is intentionally opaque to callers — they only ever use it
// as "the thing lib/server/* passes to Supabase queries". Typed loosely here so
// swapping the provider doesn't ripple a type change through every caller.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;
