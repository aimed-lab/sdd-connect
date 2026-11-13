"use client";

// lib/authClient.ts — THE CLIENT-SIDE HALF OF THE AUTH SEAM.
//
// lib/auth.ts is server-only (it reads cookies via next/headers), so a
// client component can never import it directly — that's why
// context/AuthContext.tsx used to import `supabase` from lib/supabase.ts and
// call `.auth.getSession()` / `.auth.onAuthStateChange()` on it itself. That
// made AuthContext a second, independent call site for the Supabase SDK,
// outside the seam.
//
// This file is the fix: the ONLY place in a client component that touches
// `@supabase/*` for session state. AuthContext.tsx (and anything else that
// needs to read the client-side session) goes through here instead. Under a
// future provider swap, this file plus lib/auth.ts are the only two that
// change — no consumer of AuthContext/useAuth is affected either way.
//
// READ-ONLY, same as AuthContext's own contract: session WRITES (sign in,
// sign up, sign out, SSO redirect) still go through Server Actions into
// lib/auth.ts, never through here. This just mirrors the cookie session the
// server actions already wrote, so the Nav etc. update without a reload.

import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** The current client-visible session, or null when signed out. */
export async function getClientSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** The current access token, or null when signed out. getSession() refreshes
 *  an expired token first, so a long upload can call this before each request
 *  and always send a valid one. */
export async function getClientAccessToken(): Promise<string | null> {
  const session = await getClientSession();
  return session?.access_token ?? null;
}

/** Where the browser sends a resumable (TUS) upload to Supabase Storage, and
 *  the project key that goes with it. The signed-in user's token is added per
 *  request (getClientAccessToken), so Storage applies that user's policies. */
export function getResumableUploadTarget(): { endpoint: string; apiKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !apiKey) return null;
  return { endpoint: `${url.replace(/\/+$/, "")}/storage/v1/upload/resumable`, apiKey };
}

/** Subscribe to session changes (sign-in, sign-out, token refresh). Returns
 *  an unsubscribe function. */
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}
