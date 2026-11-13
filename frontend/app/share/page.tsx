// "Share a file" — /share. A one-screen quick share: drop a file,
// link it to a paper, get a public link. See components/promote/QuickShare.tsx.
//
// SERVER component so the sign-in check runs before any form HTML is sent,
// the same gate as /promote/submit: a signed-out visitor gets the gate, not a
// screen that fails on its first upload. Every server action re-checks and RLS
// enforces ownership regardless.

import type { Metadata } from "next";
import Link from "next/link";
import QuickShare from "@/components/promote/QuickShare";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata: Metadata = { title: "Share a file" };

export default async function ShareFilePage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-[1400px] mx-auto px-margin-mobile md:px-margin-desktop py-6 md:py-8">
      <Link
        href="/files"
        className="inline-flex items-center gap-1 mb-4 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Shared files
      </Link>

      <div className="w-full max-w-xl mx-auto">
        {user ? (
          <QuickShare />
        ) : (
          <div className="glass-panel rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-4xl text-primary">lock</span>
            <h1 className="mt-3 font-headline-md text-headline-md text-on-background">Sign in to share a file</h1>
            <p className="mt-2 font-body-md text-body-md text-secondary max-w-md mx-auto">
              Files are credited to you so people know whose work it is. Anyone can open the link you share.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={`/login?callbackUrl=${encodeURIComponent("/share")}`}
                className="btn-primary px-6 py-3 rounded-lg font-label-md text-label-md"
              >
                Sign in
              </Link>
              <Link href="/files" className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md">
                See shared files
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
