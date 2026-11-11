-- =============================================================================
-- Migration: team progress updates and handover slots  (2026-11-11)
-- =============================================================================
-- WHY: the team page (/teams/<slug>) gets two cards.
--   * "Progress": short updates from members, each tagged Done, Working on or
--     Stuck.
--   * "Handover": four fixed slots (Box folder, GitHub repository, Final
--     report, Handover note).
-- Both reuse tables a team already has; each gets ONE new nullable column.
--
-- (a) community_announcements.progress_tag
--       NULL                          = ordinary news (admin / team lead only,
--                                       exactly as before).
--       'done' | 'working' | 'stuck'  = a progress update. Any ACTIVE member of
--                                       a TEAM may post one; its author or a
--                                       lead changes or deletes it. The text
--                                       is in `title` (NOT NULL); `body` stays
--                                       empty.
--     The three write policies are replaced. The admin branch of each is the
--     old policy unchanged, so a community (kind = 'community') behaves as
--     before. The SELECT policy is not touched: progress updates are readable
--     by the team's members only, like its news.
--
-- (b) community_resources.handover_slot
--       NULL                                    = an ordinary shared document.
--       'box' | 'github' | 'report' | 'note'    = that slot of the Handover
--                                                 card; at most one row per
--                                                 slot per team (unique index).
--     Links are in `url`; the note is in `description` with no url.
--     NO policy change: in a team any active member may already add a resource
--     and its uploader or a lead may change or remove it (2026-10-28_teams.sql).
--
-- "Active member" is public.is_community_member(community_id, uid): since
-- 2026-08-21_community_join.sql it requires status = 'active'. It is the same
-- function the community_resources insert policy uses.
--
-- Needs: 2026-09-02 (community_announcements), 2026-09-03 (community_resources),
-- 2026-10-28_teams.sql (public.is_team). Run once in the Supabase SQL editor.
-- Idempotent. One transaction, so the policy swap is atomic. NOT run against
-- any database as part of writing this file.
-- =============================================================================

BEGIN;

-- ── (a) progress tag ─────────────────────────────────────────────────────────

ALTER TABLE public.community_announcements
    ADD COLUMN IF NOT EXISTS progress_tag TEXT;

ALTER TABLE public.community_announcements
    DROP CONSTRAINT IF EXISTS community_announcements_progress_tag_check;
ALTER TABLE public.community_announcements
    ADD CONSTRAINT community_announcements_progress_tag_check
        CHECK (progress_tag IS NULL OR progress_tag IN ('done', 'working', 'stuck'));

-- INSERT: an admin as before, or an active member of a team posting a TAGGED
-- row. author_id stays pinned to the caller in both branches.
DROP POLICY IF EXISTS "Community announcements: admin insert" ON public.community_announcements;
DROP POLICY IF EXISTS "Community announcements: admin or team progress insert" ON public.community_announcements;
CREATE POLICY "Community announcements: admin or team progress insert"
    ON public.community_announcements FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = author_id
        AND (
            public.is_community_admin(community_id, auth.uid())
            OR (
                progress_tag IS NOT NULL
                AND public.is_team(community_id)
                AND public.is_community_member(community_id, auth.uid())
            )
        )
    );

-- UPDATE: an admin as before, or the author of a progress update. WITH CHECK
-- re-checks the NEW row: still tagged, still a team, still the author, and the
-- author is an active member of the (possibly new) community_id, so an update
-- cannot be moved into a team its author is not in or turned into news.
DROP POLICY IF EXISTS "Community announcements: admin update" ON public.community_announcements;
DROP POLICY IF EXISTS "Community announcements: admin or progress author update" ON public.community_announcements;
CREATE POLICY "Community announcements: admin or progress author update"
    ON public.community_announcements FOR UPDATE
    TO authenticated
    USING (
        public.is_community_admin(community_id, auth.uid())
        OR (
            progress_tag IS NOT NULL
            AND public.is_team(community_id)
            AND author_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_community_admin(community_id, auth.uid())
        OR (
            progress_tag IS NOT NULL
            AND public.is_team(community_id)
            AND author_id = auth.uid()
            AND public.is_community_member(community_id, auth.uid())
        )
    );

-- DELETE: an admin as before, or the author of a progress update.
DROP POLICY IF EXISTS "Community announcements: admin delete" ON public.community_announcements;
DROP POLICY IF EXISTS "Community announcements: admin or progress author delete" ON public.community_announcements;
CREATE POLICY "Community announcements: admin or progress author delete"
    ON public.community_announcements FOR DELETE
    TO authenticated
    USING (
        public.is_community_admin(community_id, auth.uid())
        OR (
            progress_tag IS NOT NULL
            AND public.is_team(community_id)
            AND author_id = auth.uid()
        )
    );

-- ── (b) handover slot ────────────────────────────────────────────────────────

ALTER TABLE public.community_resources
    ADD COLUMN IF NOT EXISTS handover_slot TEXT;

ALTER TABLE public.community_resources
    DROP CONSTRAINT IF EXISTS community_resources_handover_slot_check;
ALTER TABLE public.community_resources
    ADD CONSTRAINT community_resources_handover_slot_check
        CHECK (handover_slot IS NULL OR handover_slot IN ('box', 'github', 'report', 'note'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_resources_handover_slot
    ON public.community_resources (community_id, handover_slot)
    WHERE handover_slot IS NOT NULL;

COMMIT;
