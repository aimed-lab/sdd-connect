"use client";

// "What do you want to do?": four action cards. Three open a panel right under
// the row (one at a time); "Make learning material" opens the assistant with
// the team attached. Right after a team is created with "What will you work
// on?" filled (?learn=1), the same request is sent once for that topic
// (`learnPrompt`); the assistant then shows its usual confirm step, so the page
// is only made if the lead says yes.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { openAssistant, setPageTeam } from "@/lib/server/assistant/assistantBridge";
import { makePagePrompt } from "@/lib/server/teams/teamRules";
import {
  cleanTeamUrl,
  hasTeamOneTimeParams,
  runOnceAfterMount,
  sendLearnOnce,
  sessionStore,
} from "@/lib/server/teams/teamWorkRules";
import ActionTile, { type Tone } from "@/components/ui/ActionTile";
import AddDocumentPanel from "./AddDocumentPanel";
import CuratePagesPanel from "./CuratePagesPanel";
import NewsPanel from "./NewsPanel";
import PanelFrame from "./PanelFrame";
import { useTeamPanel } from "./TeamPanelContext";

const TILES: {
  key: "document" | "pages" | "learn" | "news";
  icon: string;
  title: string;
  blurb: string;
  action: string;
  tone: Tone;
}[] = [
  { key: "document", icon: "upload_file", title: "Share a document", blurb: "Upload a file or add a link.", action: "Upload or add a link →", tone: "blue" },
  { key: "pages", icon: "menu_book", title: "Curate wiki pages", blurb: "Add your pages or public ones.", action: "Add pages →", tone: "amber" },
  { key: "learn", icon: "auto_awesome", title: "Make learning material", blurb: "The assistant writes a wiki page for the team.", action: "Ask the AI →", tone: "green" },
  { key: "news", icon: "campaign", title: "News & promote", blurb: "Post team news or share a result.", action: "Post news →", tone: "rose" },
];

const PANEL_TITLE = {
  document: "Share a document with the team",
  pages: "Add wiki pages to the team",
  news: "News & promote",
} as const;

export default function TeamTiles({
  teamId,
  slug,
  name,
  isLead,
  learnPrompt = "",
}: {
  teamId: string;
  slug: string;
  name: string;
  isLead: boolean;
  /** Non-empty only on the lead's first visit after creating the team with a topic. */
  learnPrompt?: string;
}) {
  const { panel, toggle, close } = useTeamPanel();

  // Send the creation topic to the assistant once, on the next tick (so the
  // assistant's listener in the root layout is mounted on a full page load),
  // then drop the one-time params (?created, ?skipped, ?learn) so a reload,
  // Back or a server action can't send it again. Three guards:
  //   * runOnceAfterMount: once per mount, and Strict Mode safe;
  //   * sessionStorage "team-learn-sent:<slug>": never twice in this browser
  //     session, even if learn=1 is in the URL again;
  //   * router.replace, not window.history: Next keeps its own copy of the URL
  //     and wrote ?created=1&learn=1 back on the next server action when only
  //     the address bar was changed (see cleanTeamUrl).
  // The URL is cleaned only after the send: cleaning it re-renders the page
  // without learnPrompt, which would cancel a send still waiting on its tick.
  const router = useRouter();
  const learnSent = useRef(false);
  useEffect(() => {
    if (!learnPrompt) return;
    return runOnceAfterMount(learnSent, () => {
      sendLearnOnce(sessionStore(), slug, () =>
        openAssistant({ text: learnPrompt, mode: "send", team: { id: teamId, name, slug } })
      );
      const { pathname, search, hash } = window.location;
      if (hasTeamOneTimeParams(search)) router.replace(cleanTeamUrl(pathname, search, hash), { scroll: false });
    });
  }, [learnPrompt, teamId, name, slug, router]);

  // Tell the assistant which team this page is, so a message typed by hand
  // still makes a page for this team and stays on the page.
  useEffect(() => {
    setPageTeam({ id: teamId, name, slug });
    return () => setPageTeam(null);
  }, [teamId, name, slug]);

  const pick = (key: (typeof TILES)[number]["key"]) => {
    if (key === "learn") {
      close();
      openAssistant({ text: makePagePrompt(name), mode: "fill", team: { id: teamId, name, slug } });
      return;
    }
    toggle(key);
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="team-do">
      <h2 id="team-do" className="font-headline-sm text-[22px] leading-8 text-on-background scroll-mt-24">
        What do you want to do?
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TILES.map((t) => (
          <ActionTile
            key={t.key}
            icon={t.icon}
            title={t.title}
            description={t.blurb}
            action={t.action}
            tone={t.tone}
            featured={t.key === "learn"}
            badge={t.key === "learn" ? "AI" : undefined}
            active={t.key !== "learn" && panel === t.key}
            expanded={t.key === "learn" ? undefined : panel === t.key}
            onClick={() => pick(t.key)}
          />
        ))}
      </div>

      {panel === "document" && (
        <PanelFrame title={PANEL_TITLE.document} onClose={close}>
          <AddDocumentPanel teamId={teamId} slug={slug} onClose={close} />
        </PanelFrame>
      )}
      {panel === "pages" && (
        <PanelFrame title={PANEL_TITLE.pages} onClose={close}>
          <CuratePagesPanel teamId={teamId} slug={slug} onClose={close} />
        </PanelFrame>
      )}
      {panel === "news" && (
        <PanelFrame title={PANEL_TITLE.news} onClose={close}>
          <NewsPanel teamId={teamId} slug={slug} isLead={isLead} onClose={close} />
        </PanelFrame>
      )}
    </section>
  );
}
