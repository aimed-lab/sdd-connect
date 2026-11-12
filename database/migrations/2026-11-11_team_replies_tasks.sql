-- =============================================================================
-- Migration: replies on team progress updates, and team tasks  (2026-11-11)
-- =============================================================================
-- WHY: a team page (/teams/<slug>) works as a small project space.
--   * team_update_replies  one level of replies under a Progress update (a
--                          community_announcements row with progress_tag set).
--                          Any active team member replies; the author or a
--                          team lead deletes. No editing (no UPDATE policy).
--   * team_tasks           the team's shared task list: text, done, assignee,
--                          due date. Any active team member adds, ticks,
--                          reassigns, re-dates or deletes. The assignee must be
--                          an active member of the team (trigger).
-- Both are TEAM-only (public.is_team). Communities (kind = 'community') are not
-- touched: no existing table, policy or function changes here.
--
-- The app keeps working before this file is applied: a failed read is "no
-- replies" / "no tasks", and a failed write says the feature is not set up yet.
--
-- Needs: 2026-08-21_community_join.sql (is_community_member, status),
-- 2026-09-02 (community_announcements, is_community_admin),
-- 2026-10-28_teams.sql (public.is_team),
-- 2026-11-11_team_progress_handover.sql (community_announcements.progress_tag).
-- Run once in the Supabase SQL editor. Idempotent. One transaction. NOT run
-- against any database as part of writing this file.
-- =============================================================================

BEGIN;

-- ── replies ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_update_replies (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID        NOT NULL REFERENCES public.community_announcements (id) ON DELETE CASCADE,
    community_id    UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    author_id       UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    body            TEXT        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_update_replies_parent
    ON public.team_update_replies (announcement_id, created_at);
ALTER TABLE public.team_update_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team replies: member select" ON public.team_update_replies;
CREATE POLICY "Team replies: member select" ON public.team_update_replies FOR SELECT
    TO authenticated
    USING (public.is_community_member(community_id, auth.uid()));

-- The parent must be a progress update in the SAME team (so a reply can't be
-- filed under one team and attached to another team's update).
DROP POLICY IF EXISTS "Team replies: member insert" ON public.team_update_replies;
CREATE POLICY "Team replies: member insert" ON public.team_update_replies FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = author_id
        AND public.is_team(community_id)
        AND public.is_community_member(community_id, auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.community_announcements a
            WHERE a.id = team_update_replies.announcement_id
              AND a.community_id = team_update_replies.community_id
              AND a.progress_tag IS NOT NULL
        )
    );

DROP POLICY IF EXISTS "Team replies: author or lead delete" ON public.team_update_replies;
CREATE POLICY "Team replies: author or lead delete" ON public.team_update_replies FOR DELETE
    TO authenticated
    USING (author_id = auth.uid() OR public.is_community_admin(community_id, auth.uid()));
-- No UPDATE policy: replies are not edited.

-- ── tasks ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_tasks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id UUID        NOT NULL REFERENCES public.communities (id) ON DELETE CASCADE,
    text         TEXT        NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 300),
    done         BOOLEAN     NOT NULL DEFAULT false,
    assignee_id  UUID        REFERENCES public.users (id) ON DELETE SET NULL,
    due_date     DATE,
    position     INTEGER     NOT NULL DEFAULT 0,
    created_by   UUID        REFERENCES public.users (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_tasks_team ON public.team_tasks (community_id, done, position);
CREATE INDEX IF NOT EXISTS idx_team_tasks_assignee ON public.team_tasks (assignee_id) WHERE assignee_id IS NOT NULL;
ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;

-- Any active member of the TEAM does everything, like project checklists.
DROP POLICY IF EXISTS "Team tasks: member select" ON public.team_tasks;
CREATE POLICY "Team tasks: member select" ON public.team_tasks FOR SELECT TO authenticated
    USING (public.is_team(community_id) AND public.is_community_member(community_id, auth.uid()));
DROP POLICY IF EXISTS "Team tasks: member insert" ON public.team_tasks;
CREATE POLICY "Team tasks: member insert" ON public.team_tasks FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid() AND public.is_team(community_id)
                AND public.is_community_member(community_id, auth.uid()));
DROP POLICY IF EXISTS "Team tasks: member update" ON public.team_tasks;
CREATE POLICY "Team tasks: member update" ON public.team_tasks FOR UPDATE TO authenticated
    USING (public.is_team(community_id) AND public.is_community_member(community_id, auth.uid()))
    WITH CHECK (public.is_team(community_id) AND public.is_community_member(community_id, auth.uid()));
DROP POLICY IF EXISTS "Team tasks: member delete" ON public.team_tasks;
CREATE POLICY "Team tasks: member delete" ON public.team_tasks FOR DELETE TO authenticated
    USING (public.is_team(community_id) AND public.is_community_member(community_id, auth.uid()));

-- The assignee must be an active member of the team (RLS can't say this).
CREATE OR REPLACE FUNCTION public.team_tasks_guard_assignee()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.assignee_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
       AND NOT public.is_community_member(NEW.community_id, NEW.assignee_id) THEN
        RAISE EXCEPTION 'team_tasks: the assignee must be a member of the team' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.team_tasks_guard_assignee() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_tasks_guard_assignee() FROM anon;
DROP TRIGGER IF EXISTS team_tasks_guard_assignee_trg ON public.team_tasks;
CREATE TRIGGER team_tasks_guard_assignee_trg BEFORE INSERT OR UPDATE ON public.team_tasks
    FOR EACH ROW EXECUTE FUNCTION public.team_tasks_guard_assignee();

COMMIT;
