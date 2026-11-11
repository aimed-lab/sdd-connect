"use client";

// Shared shell nav. Left: the menu button (opens the side menu,
// components/SideMenu.tsx, on every screen size), the wordmark, then Explore /
// Collaborate / Promote with an active highlight (desktop only). Right: Sign in
// (desktop; on a phone it is in the side menu), or the inbox bell and a round
// profile button that links to Settings.
// VISUAL style is taken from
// design/stitch/smartdrugdiscovery_landing_page/code.html.
// The nav inside individual page HTML is ignored — this is the one.
//
// There is no account dropdown and no separate phone menu any more: My
// projects, My teams, My wiki pages, Saved items and Sign out are in the side
// menu.
//
// NO THEME TOGGLE: there used to be one here (a button flipping a `dark`
// class on <html>). Removed — the class was wired correctly, but there was
// no `dark:` style anywhere in the app for it to affect, so it was a
// control that visibly did nothing. `darkMode: "class"` is still set in
// tailwind.config.ts and nothing stops a future dark theme from using it;
// there just isn't one to toggle to yet.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SideMenu from "@/components/SideMenu";
import { useAuth } from "@/context/AuthContext";
import { initialsOf, nextOpen, type MenuEvent } from "@/lib/server/nav/sideMenu";

const PILLARS = [
  { label: "Explore", href: "/explore" },
  { label: "Collaborate", href: "/collaborate" },
  { label: "Promote", href: "/promote" },
] as const;

// Projects used to be a pillar here (added only when signed in, since a
// signed-out visitor has nothing to see at /projects — it redirects
// straight to /login). It is in the side menu instead, as "My projects"
// (lib/server/nav/sideMenu.ts). /projects and /projects/[id] themselves are unchanged; every
// other link into them (the landing page's "Start a Project" button, a
// community's Projects section, a project card, etc.) still points at the
// same routes and needs no update.
//
// Communities used to be a pillar here too. It's now a category inside
// Explore (components/explore/CommunitiesResultsSection.tsx) instead of
// its own destination — /communities and /communities/[slug] still work
// as URLs, same as /projects does; the side menu's Discover group links to
// /communities too.

// Unseen count for the inbox badge. Refetched on every navigation so that
// opening /inbox (which marks things seen) is reflected when you leave it.
//
// Signed out we don't call at all and hold 0 — the badge simply isn't rendered,
// and there's no reason to ask the server about an inbox that can't exist.
function useUnseenInbox(signedIn: boolean, pathname: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inbox/count", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setCount(typeof json?.count === "number" ? json.count : 0);
      } catch {
        // A badge is not worth surfacing an error for; leave it at its last value.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, pathname]);

  return count;
}

export default function Nav() {
  const pathname = usePathname();
  const { user, displayName, signOut } = useAuth();
  const unseen = useUnseenInbox(!!user, pathname);
  const [sideOpen, setSideOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onMenuEvent = useCallback((event: MenuEvent) => setSideOpen((open) => nextOpen(open, event)), []);

  // Moving to another page any other way (browser back) closes the menu too.
  useEffect(() => {
    onMenuEvent("navigate");
  }, [pathname, onMenuEvent]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <nav className="fixed top-0 left-0 w-full z-50 h-16 bg-[#fbfaf7]/85 backdrop-blur-xl border-b border-[#e7e4dc]">
        <div className="max-w-container-max mx-auto h-full flex justify-between items-center gap-2 px-margin-mobile md:px-margin-desktop">
          {/* Left: menu button + wordmark + center pillars */}
          <div className="flex items-center gap-8 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => onMenuEvent("menu_button")}
                aria-label="Open menu"
                aria-haspopup="dialog"
                aria-expanded={sideOpen}
                className="shrink-0 -ml-2.5 w-11 h-11 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low transition-all"
              >
                <span aria-hidden="true" className="material-symbols-outlined">
                  menu
                </span>
              </button>
              {/* Smaller on a phone only, so the bell and the profile button fit beside it. */}
              <Link href="/" className="min-w-0 truncate font-label-md text-[24px] max-sm:text-[18px] leading-8 font-bold text-on-background">
                SmartDrugDiscovery
              </Link>
            </div>
            <div className="hidden md:flex items-center gap-6">
              {PILLARS.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className={
                    isActive(p.href)
                      ? "font-body-md text-body-md text-primary font-bold border-b-2 border-primary pb-1"
                      : "font-body-md text-body-md text-secondary hover:text-primary transition-colors"
                  }
                >
                  {p.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right: auth — default to logged-out until we know otherwise (avoids a
              flicker and keeps the actions in the server-rendered HTML) */}
          <div className="shrink-0 flex items-center gap-2">
            {/* One SSO button — no separate "Log in" vs "Sign up" anymore
                (see app/signup/page.tsx and app/login/page.tsx). Desktop only:
                on a phone, Sign in is at the bottom of the side menu. */}
            {!user && (
              <Link href="/login" className="hidden md:inline-block btn-primary px-6 py-2 rounded-lg font-label-md text-label-md">
                Sign in
              </Link>
            )}
            {user && (
              <Link
                href="/inbox"
                aria-label={unseen > 0 ? `Inbox, ${unseen} unread` : "Inbox"}
                className={
                  "relative p-2 rounded-full transition-all hover:bg-surface-container-low " +
                  (isActive("/inbox") ? "text-primary" : "text-secondary")
                }
              >
                {/* Bell reads as "something arrived" more immediately than the
                    inbox-tray icon did, especially with the unread badge on
                    it — route, label, and count are all unchanged. */}
                <span className="material-symbols-outlined">notifications</span>
                {unseen > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-on-primary font-label-sm text-[11px] leading-none">
                    {unseen > 99 ? "99+" : unseen}
                  </span>
                )}
              </Link>
            )}
            {user && (
              <Link
                href="/settings"
                aria-label="My profile"
                className="w-11 h-11 rounded-full bg-[#e4efe7] text-[#1A5632] flex items-center justify-center font-label-md text-label-md font-bold hover:bg-[#d3e5d8] transition-colors"
              >
                <span aria-hidden="true">{initialsOf(displayName)}</span>
              </Link>
            )}
          </div>
        </div>
      </nav>

      <SideMenu
        open={sideOpen}
        pathname={pathname}
        signedIn={!!user}
        name={displayName}
        onEvent={onMenuEvent}
        onSignOut={signOut}
        menuButtonRef={menuButtonRef}
      />
    </>
  );
}
