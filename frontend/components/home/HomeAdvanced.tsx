"use client";

// The "Advanced" toggle on the home page: collapsed by default, opens in place to
// show its children (the flywheel and the hub map), closes again on a second click.
// Children are rendered by the server page and passed in, so nothing here fetches.

import { useState, type ReactNode } from "react";

export default function HomeAdvanced({ defaultOpen = false, children }: { defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="flex flex-col items-center gap-1.5 px-margin-mobile md:px-margin-desktop">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="home-advanced"
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[#1A5632] bg-transparent px-6 font-label-md text-label-md text-[#1A5632] hover:bg-[#f3f1ea] hover:text-[#033319] hover:border-[#033319] transition-colors"
        >
          Advanced
          <span className="material-symbols-outlined text-[20px]" aria-hidden>
            {open ? "expand_less" : "expand_more"}
          </span>
        </button>
        <p className="text-[13px] leading-5 text-secondary">Hub map and our mission</p>
      </div>
      {open && (
        <div id="home-advanced" className="mt-6">
          {children}
        </div>
      )}
    </div>
  );
}
