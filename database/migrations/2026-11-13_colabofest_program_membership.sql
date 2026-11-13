-- =============================================================================
-- Migration: ColaboFest program membership  (2026-11-13)
-- =============================================================================
-- ALREADY APPLIED on the database on 2026-11-13. This file exists so the repo
-- matches what is live. Re-running it is safe (CREATE OR REPLACE, same body).
--
-- WHY: public.is_community_member() treats the lead and members of every
-- ColaboFest project as members of the "ColaboFest 2026" community
-- (slug 'colabofest-2026'), without writing community_members rows. Until now
-- it only matched projects entered through the registration flow
-- (projects.challenge_key = 'colabofest_2026'). The eight winning teams are
-- marked with projects.program = 'colabofest_2026' instead
-- (2026-10-31_project_program.sql), so their members were not counted.
--
-- WHAT CHANGED: the project join now matches either column:
--   ON (p.challenge_key = 'colabofest_2026' OR p.program = 'colabofest_2026')
-- Everything else is identical to the definition in
-- 2026-08-21_community_join.sql: same arguments, LANGUAGE sql, STABLE,
-- SECURITY DEFINER, search_path public, active-status rule for real rows.
--
-- What it does NOT do: it writes no rows. The community roster and member
-- counts read community_members directly, so these members are not listed
-- there; they get member access everywhere a policy calls this function.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_community_member(p_community_id uuid, p_uid uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'public'
AS $$
    SELECT
        EXISTS (
            SELECT 1
            FROM public.community_members cm
            WHERE cm.community_id = p_community_id
              AND cm.user_id = p_uid
              AND cm.status = 'active'
        )
        OR EXISTS (
            SELECT 1
            FROM public.communities c
            JOIN public.projects p
              ON (p.challenge_key = 'colabofest_2026' OR p.program = 'colabofest_2026')
            WHERE c.id = p_community_id
              AND c.slug = 'colabofest-2026'
              AND (
                  p.lead_id = p_uid
                  OR EXISTS (
                      SELECT 1 FROM public.project_members pm
                      WHERE pm.project_id = p.id AND pm.user_id = p_uid
                  )
              )
        );
$$;
