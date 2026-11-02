// Events: /events. Two sections (ids conferences, contests) that the home map links to.
// The lists live in lib/events.ts. Server component. Not in the top nav.

import Link from "next/link";
import SectionHeading from "@/components/explore/SectionHeading";
import { conferences, contests, type EventItem } from "@/lib/events";

export const metadata = { title: "Events" };

const LINK = "text-[#1A5632] hover:text-[#033319] hover:underline underline-offset-4";

function EventCards({ items }: { items: EventItem[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((e) => (
        <li key={e.name} className="rounded-[14px] border border-[#e2dfd6] bg-white p-5 flex flex-col gap-1.5">
          <h3 className="font-title text-[18px] leading-6 text-on-background">{e.name}</h3>
          {e.note && <p className="font-body-md text-[14px] leading-5 text-secondary">{e.note}</p>}
          <p className="mt-auto pt-2 text-[13px] leading-5">
            {e.external ? (
              <a href={e.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                Open ↗
              </a>
            ) : (
              <Link href={e.href} className={LINK}>
                Open →
              </Link>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function EventsPage() {
  return (
    <section className="bg-[var(--explore-bg)]">
      <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
        <Link
          href="/"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1 mb-6"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Home
        </Link>

        <div className="max-w-3xl space-y-3 mb-10">
          <h1 className="font-display-lg text-display-lg text-on-background">Events</h1>
          <p className="font-body-lg text-body-lg text-secondary">
            Conferences and contests across the drug discovery community.
          </p>
        </div>

        <div className="flex flex-col gap-14">
          <section id="conferences" className="scroll-mt-20">
            <SectionHeading title="Conferences" />
            <EventCards items={conferences} />
          </section>
          <section id="contests" className="scroll-mt-20">
            <SectionHeading title="Contests" />
            <EventCards items={contests} />
          </section>
        </div>
      </div>
    </section>
  );
}
