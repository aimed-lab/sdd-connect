// Landing page ("/"): a simple, phone-first home. A compact green header with the
// Explore question box, a grid of eight tiles (each one link), and an "Advanced"
// button that opens, in place, the flywheel, the "three scales" band and the hub
// map (?advanced=1 starts it open). Nav + Footer come from the root layout.
//
// Hidden from the home page (components kept, just not rendered here): the hero,
// the "Explore on your own" news/podcast strip, the closing call-to-action bars and
// the locked-network preview (LockedNetworkCard).
//
// SERVER component; no data reads.

import Link from "next/link";
import FlywheelSection from "@/components/FlywheelSection";
import DiscoveryMap from "@/components/DiscoveryMap";
import HomeAdvanced from "@/components/home/HomeAdvanced";
import HomeQuestionBox from "@/components/home/HomeQuestionBox";

const WRAP = "max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop";

const TILES: { label: string; hint: string; href: string; icon: string }[] = [
  { label: "Papers", hint: "Newest research", href: "/explore?category=paper", icon: "article" },
  { label: "Grants", hint: "Open, by deadline", href: "/explore?category=grant", icon: "payments" },
  { label: "Clinical trials", hint: "Recruiting now", href: "/explore?category=trial", icon: "science" },
  { label: "Tools & data", hint: "Free and open", href: "/explore?category=tool", icon: "build" },
  { label: "Podcast", hint: "Drug Discovery AI Talk", href: "/explore/podcast", icon: "podcasts" },
  { label: "Events", hint: "Conferences, contests", href: "/events", icon: "event" },
  { label: "Communities", hint: "Researchers like you", href: "/communities", icon: "groups" },
  { label: "SPARC", hint: "Papers, tools, patents", href: "/sparc", icon: "hub" },
];

const JOIN_FORM =
  "https://docs.google.com/forms/d/e/1FAIpQLSdatp8U8wFMeubaaD9GPr-1jWun9r4qAnVB4SjBSurXvvIjXw/viewform";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const adv = Array.isArray(sp.advanced) ? sp.advanced[0] : sp.advanced;

  return (
    <div className="bg-[var(--explore-bg)]">
      {/* 1. Compact header with the question box */}
      <section className="bg-[#1A5632] text-white">
        <div className={`${WRAP} py-8 md:py-10`}>
          <div className="max-w-3xl mx-auto">
            <h1 className="font-title text-[28px] md:text-[34px] leading-tight font-medium">Drug discovery resources, in one place</h1>
            <p className="mt-1 mb-5 font-body-md text-body-md text-white/85">Free and open, from UAB&apos;s Systems Pharmacology AI Research Center (SPARC).</p>
            <HomeQuestionBox />
          </div>
        </div>
      </section>

      {/* 2. Eight tiles, each one link */}
      <section className={`${WRAP} py-8 md:py-10`}>
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-4xl mx-auto">
          {TILES.map((t) => (
            <li key={t.label} className="min-w-0">
              <Link
                href={t.href}
                className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 rounded-[12px] border border-[#e2dfd6] bg-white p-4 text-center hover:border-[#1A5632] transition-colors"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#f3f1ea] text-[#1A5632]">
                  <span className="material-symbols-outlined text-[24px]" aria-hidden>
                    {t.icon}
                  </span>
                </span>
                <span className="font-label-md text-[15px] leading-5 text-on-background break-words">{t.label}</span>
                <span className="text-[12px] leading-4 text-[#6b6b6b] break-words">{t.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Join line */}
      <section className={`${WRAP} pb-8 md:pb-10`}>
        <a
          href={JOIN_FORM}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-[10px] bg-[#f3f1ea] px-[14px] py-3 text-[15px] leading-6 text-on-background"
        >
          <span>UAB faculty? Join SPARC</span>
          <span className="shrink-0 font-medium text-[#1A5632] hover:text-[#033319]">Apply →</span>
        </a>
      </section>

      {/* 3. Advanced: flywheel, three scales, hub map */}
      <section className="pb-12 md:pb-16">
        <HomeAdvanced defaultOpen={adv === "1"}>
          <FlywheelSection />
          <div id="hub-map" className="scroll-mt-16">
            <div className={`${WRAP} pb-4`}>
              <div className="max-w-3xl mx-auto text-center mb-4">
                <h2 className="font-title text-[28px] md:text-[30px] leading-tight font-medium text-on-background">
                  Explore the hub
                </h2>
                <p className="mt-2 font-body-md text-body-md text-secondary">Every stop opens a real page. Start anywhere.</p>
              </div>
              <DiscoveryMap />
            </div>
          </div>
        </HomeAdvanced>
      </section>
    </div>
  );
}
