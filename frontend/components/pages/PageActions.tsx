"use client";

// The buttons under a wiki page's title: "Ask the assistant" and, for a viewer
// who has something to see there, "Page settings". Page settings opens a panel
// with the owner controls (who can see the page, keep it updated, rename,
// delete) and the Team panel, exactly as they were at the top of the page; a
// member of a team page gets the read-only member list. The page decides what
// goes in the panel and passes it as `settings`; with nothing to show there is
// no button.
//
// A link to /pages/<slug>#team (the assistant gives one after making a team
// page) opens the panel, since the Team panel lives inside it.

import { useEffect, useId, useState } from "react";
import { AskAssistantButton } from "./NewWikiPageButton";

export default function PageActions({ title, settings }: { title: string; settings: React.ReactNode | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (settings && window.location.hash === "#team") {
      setOpen(true);
      // The panel is in the page only now; bring the Team part into view.
      requestAnimationFrame(() => document.getElementById("team")?.scrollIntoView({ block: "start" }));
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <AskAssistantButton title={title} />
        {settings && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className="btn-outline inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              settings
            </span>
            Page settings
          </button>
        )}
      </div>
      {settings && (
        <div id={panelId} hidden={!open} className="mt-6">
          {settings}
        </div>
      )}
    </>
  );
}
