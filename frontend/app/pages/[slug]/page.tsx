// /pages/[slug] — a wiki page: the header, then five tabs (?tab=): What's new,
// Papers, Datasets, Background (the page's sections, with numbered citations)
// and More sources (every other kind collected). Without ?tab= it opens on the
// viewer's saved tab (the wiki_tab cookie), else What's new when it has
// something, else Background. Owner controls and the team panel are behind
// "Page settings". Server-rendered through the visitor's OWN
// Supabase session (lib/server/pages/pageView.ts), so RLS decides who can see
// it: signed-out visitors get public pages, owners and team members get theirs.
//
// A page the visitor may not read comes back from the database exactly like a
// page that doesn't exist, and both become the same plain 404, so a private
// page's existence is never revealed. Owner controls and the team panel are a
// convenience for the owner; the server actions and RLS are the real gate.

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { pageCrumbs } from "@/lib/server/pages/pageEditCore";
import PageActions from "@/components/pages/PageActions";
import PageControls from "@/components/pages/PageControls";
import PageNotes from "@/components/pages/PageNotes";
import PageSources from "@/components/pages/PageSources";
import PageTabs from "@/components/pages/PageTabs";
import TeamPanel from "@/components/pages/TeamPanel";
import VisibilityBadge from "@/components/pages/VisibilityBadge";
import WhatsNew from "@/components/pages/WhatsNew";
import { getPageView } from "@/lib/server/pages/pageView";
import {
  VISIBILITY_INFO,
  WIKI_TAB_COOKIE,
  creationLine,
  formatDay,
  initialSourceCount,
  isWikiTab,
  pickWikiTab,
  wikiTabCounts,
} from "@/lib/server/pages/pageViewHelpers";

export const dynamic = "force-dynamic"; // depends on the session

export default async function LivingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const result = await getPageView(slug);
  if (result.status === "not_found") notFound();
  if (result.status === "error") {
    return (
      <div className="max-w-3xl mx-auto px-margin-mobile md:px-margin-desktop py-16">
        <p className="font-body-md text-body-md text-error" role="alert">
          Couldn&apos;t load this page. Please try again.
        </p>
      </div>
    );
  }

  const { page, viewer, notes, evidence, updates, members, project, parent } = result.view;
  const crumbs = pageCrumbs({ project, parent });
  const updated = formatDay(page.last_refreshed_at);
  const showTeam = viewer.isOwner || (page.visibility === "team" && members.length > 0);
  const empty = notes.length === 0 && evidence.length === 0;

  // Tabs: a valid ?tab= wins; else the viewer's saved choice; else What's new
  // when it has something; else Background.
  const savedRaw = (await cookies()).get(WIKI_TAB_COOKIE)?.value;
  const saved = isWikiTab(savedRaw) ? savedRaw : null;
  const counts = wikiTabCounts({ updates: updates.length, evidence, notes: notes.length });
  const tab = pickWikiTab({ param: Array.isArray(query.tab) ? query.tab[0] : query.tab, saved, newCount: counts.new });

  // What "Page settings" opens. The owner: the controls and, off a project, the
  // Team panel. A member of a team page: the member list, read-only. Anyone
  // else: nothing, so there is no button.
  const settings = viewer.isOwner ? (
    project ? (
      <PageControls
        pageId={page.id}
        slug={page.slug}
        title={page.title}
        visibility={page.visibility}
        refreshEnabled={page.refresh_enabled}
        projectName={project.name}
      />
    ) : (
      <div className="flex flex-col gap-6">
        <PageControls
          pageId={page.id}
          slug={page.slug}
          title={page.title}
          visibility={page.visibility}
          refreshEnabled={page.refresh_enabled}
        />
        <TeamPanel pageId={page.id} slug={page.slug} visibility={page.visibility} members={members} isOwner />
      </div>
    )
  ) : !project && showTeam ? (
    <div className="max-w-xl">
      <TeamPanel pageId={page.id} slug={page.slug} visibility={page.visibility} members={members} isOwner={false} />
    </div>
  ) : null;

  return (
    <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 flex flex-col gap-14">
      <header className="max-w-3xl">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-4 font-label-md text-label-md text-secondary">
            <span aria-hidden>← </span>
            {crumbs.map((c, i) => (
              <span key={c.label + i}>
                {i > 0 && <span className="mx-1.5 text-secondary/60">/</span>}
                <Link href={c.href} className="hover:text-primary hover:underline underline-offset-4">
                  {c.label}
                </Link>
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!project && <VisibilityBadge visibility={page.visibility} />}
          {updated && <span className="font-label-sm text-label-sm text-secondary">Updated {updated}</span>}
          {page.refresh_enabled && (
            <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-secondary">
              <span className="material-symbols-outlined text-[14px]">autorenew</span>
              Keeps itself updated
            </span>
          )}
        </div>
        <h1 className="mt-3 font-display-lg text-[40px] leading-tight text-on-background">{page.title}</h1>
        <p className="mt-3 font-body-lg text-body-lg text-on-background/80">
          Everything on this topic in one place. Pick the tab for what you need.
        </p>
        {!project && (
          <p className="mt-2 font-body-sm text-body-sm text-secondary">{VISIBILITY_INFO[page.visibility].line}</p>
        )}
        {project && !viewer.isOwner && (
          <p className="mt-2 font-body-sm text-body-sm text-secondary">Shared with everyone on {project.name}.</p>
        )}
        <PageActions title={page.title} settings={settings} />
      </header>

      {empty && (
        <div className="glass-panel rounded-2xl p-8 text-center max-w-3xl">
          <p className="font-body-md text-body-md text-secondary">
            Nothing has been collected for this wiki page yet. It fills in after its first update, usually within a day.
            In the meantime, ask the assistant a question about this topic.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-10">
        <PageTabs slug={page.slug} current={tab} counts={counts} saved={saved} />

        {tab === "new" && (
          <WhatsNew
            updates={updates}
            createdLine={creationLine(
              page.created_at,
              initialSourceCount(evidence.map((e) => e.id), updates)
            )}
          />
        )}
        {(tab === "papers" || tab === "datasets" || tab === "other") && <PageSources evidence={evidence} tab={tab} />}
        {tab === "background" && (
          <PageNotes
            notes={notes}
            evidence={evidence}
            pageId={page.id}
            pageSlug={page.slug}
            canEdit={viewer.canEdit}
            isOwner={viewer.isOwner}
          />
        )}
      </div>
    </div>
  );
}
