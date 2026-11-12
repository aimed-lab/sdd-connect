// A team's page — /teams/[slug]. Simple and calm: a green hero (label, name,
// one line, avatars, QR), then Progress and Handover side by side (stacked on a
// phone), Tasks (full width), "What do you want to do?" with four tiles, then cards: Team wiki pages
// and Shared documents (left), People and Team news (right). Nothing public: no
// Explore feed, no tabs.
//
// Progress shows the team's tagged announcements and Handover its slotted
// resources (2026-11-11_team_progress_handover.sql); those rows are left out of
// Team news and Shared documents. Replies under Progress updates and the Tasks
// card come from 2026-11-11_team_replies_tasks.sql; before it is applied they
// read as "no replies" / "no tasks".
//
// Someone who is not on the team (a QR scan, a shared link) sees only the
// team's name and description and one button to join. Team content is
// members-only in the database (RLS), not just hidden here.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  claimPendingCommunityMemberships,
  getCommunityBySlug,
  getMembership,
  getPinnedResourceId,
  listAnnouncements,
  listCommunityMembers,
  listCommunityResources,
  listMemberRoster,
} from "@/lib/server/communities";
import {
  getTeamJoinInfo,
  listCommunitiesToLink,
  listHandoverSlots,
  listProgressTags,
  listTeamCommunities,
  listTeamPages,
} from "@/lib/server/teams/teams";
import { creationLearnPrompt, splitAnnouncements, splitResources } from "@/lib/server/teams/teamRules";
import { listProgressReplies, listTeamTasks } from "@/lib/server/teams/teamWork";
import { groupReplies, teamToday } from "@/lib/server/teams/teamWorkRules";
import TasksCard from "@/components/teams/TasksCard";
import TeamCreatedNotice from "@/components/teams/TeamCreatedNotice";
import { PageShell } from "@/components/PageHeader";
import TeamHeader from "@/components/teams/TeamHeader";
import HandoverCard from "@/components/teams/HandoverCard";
import ProgressCard from "@/components/teams/ProgressCard";
import TeamJoinCard from "@/components/teams/TeamJoinCard";
import TeamTiles from "@/components/teams/TeamTiles";
import { TeamPanelProvider } from "@/components/teams/TeamPanelContext";
import TeamSettings from "@/components/teams/TeamSettings";
import { DocumentsShelf, NewsList, PagesShelf, PeopleShelf } from "@/components/teams/TeamShelves";

export const dynamic = "force-dynamic"; // depends on the session

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await getCommunityBySlug(slug);
  return { title: team ? `${team.name} · Team · SmartDrugDiscovery` : "Team · SmartDrugDiscovery" };
}

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ join?: string; created?: string; skipped?: string; settings?: string; learn?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  // Team rows are readable only by their members and site admins, so this is
  // null for everyone else, and for an unknown slug.
  const team = await getCommunityBySlug(slug);
  if (team && team.kind !== "team") redirect(`/communities/${slug}`);

  // Link anyone added by email before they had an account, then read their row.
  await claimPendingCommunityMemberships();
  const [user, membership] = await Promise.all([
    getCurrentUser(),
    team ? getMembership(team.id) : Promise.resolve(null),
  ]);

  // Not on the team: name, description, one button. A visitor gets these from
  // get_team_join_info (the only thing a team link reveals); an unknown slug 404s.
  if (!team || !membership || membership.state !== "active") {
    const info = team
      ? { id: team.id, name: team.name, description: team.description }
      : await getTeamJoinInfo(slug);
    if (!info) notFound();
    return (
      <PageShell narrow>
        <TeamJoinCard
          teamId={info.id}
          slug={slug}
          name={info.name}
          description={info.description}
          state={membership?.state ?? (user ? "none" : "signed_out")}
          autoOpen={query.join === "1"}
          autoJoin={query.join === "signin"}
        />
      </PageShell>
    );
  }

  const isLead = membership.isAdmin;
  const [roster, allResources, pinnedId, pages, allAnnouncements, members, linked, linkable, progressTags, handoverSlots, replyRows, tasks] = await Promise.all([
    listMemberRoster(team.id),
    listCommunityResources(team.id),
    getPinnedResourceId(team.id),
    listTeamPages(team.id),
    listAnnouncements(team.id),
    isLead ? listCommunityMembers(team.id) : Promise.resolve([]),
    isLead ? listTeamCommunities(team.id) : Promise.resolve([]),
    isLead ? listCommunitiesToLink() : Promise.resolve([]),
    listProgressTags(team.id),
    listHandoverSlots(team.id),
    // Both are [] until 2026-11-11_team_replies_tasks.sql is applied.
    listProgressReplies(team.id),
    listTeamTasks(team.id),
  ]);
  const replies = groupReplies(replyRows);

  // Tagged announcements are Progress, the rest Team news; slotted resources are
  // Handover, the rest Shared documents.
  const { news: announcements, progress } = splitAnnouncements(allAnnouncements, progressTags);
  const { handover, documents: resources } = splitResources(allResources, handoverSlots);

  const names: Record<string, string> = Object.fromEntries(
    roster.filter((m) => m.user_id).map((m) => [m.user_id as string, m.display_name])
  );
  const skipped = Number(query.skipped) || 0;
  // The team's members with an account, for the task assignee picker.
  const taskMembers = roster
    .filter((m) => m.user_id)
    .map((m) => ({ id: m.user_id as string, name: m.display_name }));
  // Just created with "What will you work on?" filled: the lead's assistant
  // opens once with the wiki page request for that topic (nothing is created
  // until they confirm). The param is dropped from the URL after that.
  const learnPrompt = query.learn === "1" && isLead ? creationLearnPrompt(team.name, team.description) : "";
  // Today in US Central time, for "Today" / "Tomorrow" / overdue on the Tasks card.
  const today = teamToday();

  return (
    <PageShell className="flex flex-col gap-6 !max-w-[1120px]">
      <div>
        <Link
          href="/teams"
          className="font-label-sm text-label-sm text-secondary hover:text-primary transition-colors inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Your teams
        </Link>
      </div>

      {/* Rendered on every visit (it shows nothing without ?created=1) so it
          keeps its place, and its message, after the URL is cleaned. */}
      <TeamCreatedNotice slug={team.slug} created={query.created === "1"} skipped={skipped} learnPending={!!learnPrompt} />

      <TeamPanelProvider>
        <TeamHeader
          team={team}
          memberCount={roster.length}
          memberNames={roster.map((m) => m.display_name)}
          isLead={isLead}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <ProgressCard
            teamId={team.id}
            slug={team.slug}
            items={progress.map((u) => ({ id: u.id, author_id: u.author_id, title: u.title, created_at: u.created_at, tag: u.tag }))}
            replies={replies}
            names={names}
            viewerId={user?.id ?? ""}
            isLead={isLead}
          />
          <HandoverCard
            teamId={team.id}
            slug={team.slug}
            rows={handover.map((h) => ({
              ...h,
              resource: h.resource
                ? {
                    id: h.resource.id,
                    added_by: h.resource.added_by,
                    url: h.resource.url,
                    description: h.resource.description,
                    created_at: h.resource.created_at,
                  }
                : null,
            }))}
            names={names}
            viewerId={user?.id ?? ""}
            isLead={isLead}
          />
        </div>

        <TasksCard teamId={team.id} slug={team.slug} tasks={tasks} members={taskMembers} today={today} />

        <TeamTiles teamId={team.id} slug={team.slug} name={team.name} isLead={isLead} learnPrompt={learnPrompt} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
            <PagesShelf teamId={team.id} teamName={team.name} slug={team.slug} pages={pages} names={names} />
            <DocumentsShelf
              teamId={team.id}
              slug={team.slug}
              resources={resources}
              pinnedId={pinnedId}
              viewerId={user?.id ?? ""}
              isLead={isLead}
              names={names}
            />
          </div>
          <div className="flex flex-col gap-6 min-w-0">
            <PeopleShelf teamId={team.id} roster={roster} viewerUserId={user?.id ?? ""} isLead={isLead} />
            <NewsList teamId={team.id} slug={team.slug} items={announcements} isLead={isLead} />
          </div>
        </div>
      </TeamPanelProvider>

      {isLead && (
        <TeamSettings
          team={team}
          members={members}
          viewerUserId={user?.id ?? ""}
          linked={linked}
          linkable={linkable}
          defaultOpen={query.settings === "1"}
        />
      )}
    </PageShell>
  );
}
