"use client";

// The tab bar of a wiki page: What's new, Papers, Datasets, Background, More
// sources, each with its item count. A tab is a link (?tab=<key>); the page is
// rendered on the server one tab at a time. On a phone the tabs scroll sideways.
//
// "Always open on" at the right end saves the viewer's choice in a cookie
// (lib/server/pages/pageViewHelpers.ts: wikiTabCookie) and goes to that tab.
// The server reads the cookie when a wiki page is opened without ?tab=. It
// works signed in or out; nothing is stored in the database.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { WIKI_TABS, isWikiTab, wikiTabCookie, wikiTabHref, type WikiTab } from "@/lib/server/pages/pageViewHelpers";

export default function PageTabs({
  slug,
  current,
  counts,
  saved,
}: {
  slug: string;
  current: WikiTab;
  counts: Record<WikiTab, number>;
  /** The viewer's saved "Always open on" choice, if any. */
  saved: WikiTab | null;
}) {
  const router = useRouter();

  const save = (value: string) => {
    if (!isWikiTab(value)) return;
    document.cookie = wikiTabCookie(value);
    router.push(wikiTabHref(slug, value));
    // The select shows the saved choice, which the server reads from the cookie.
    router.refresh();
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-x-4 gap-y-2 border-b border-[#e7e4dc]">
      <nav aria-label="Wiki page sections" className="min-w-0 flex-1 -mb-px overflow-x-auto overflow-y-hidden">
        <ul className="flex items-stretch gap-1 min-w-max">
          {WIKI_TABS.map((t) => {
            const active = t.key === current;
            return (
              <li key={t.key} className="flex">
                <Link
                  href={wikiTabHref(slug, t.key)}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className={
                    "min-h-11 inline-flex items-center gap-2 px-3.5 border-b-2 whitespace-nowrap font-label-md text-label-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
                    (active
                      ? "border-primary text-primary font-bold"
                      : "border-transparent text-secondary hover:text-primary hover:border-[#d9d5c9]")
                  }
                >
                  {t.label}
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[12px] font-semibold leading-4 " +
                      (active ? "bg-[#e4efe7] text-[#1A5632]" : "bg-[#f1efe8] text-secondary")
                    }
                  >
                    {counts[t.key]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <label className="shrink-0 flex items-center gap-2 pb-1.5 font-body-sm text-body-sm text-secondary">
        Always open on
        <select
          value={saved ?? ""}
          onChange={(e) => save(e.target.value)}
          className="min-h-11 rounded-lg border border-[#d9d5c9] bg-white px-2.5 py-1.5 font-label-md text-label-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {saved === null && (
            <option value="" disabled>
              Choose a tab
            </option>
          )}
          {WIKI_TABS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
