-- =============================================================================
-- Migration: Promote paper year  (2026-11-13)
-- =============================================================================
-- WHY: the "From the paper" card on a download page (a "Share a file" item)
-- shows the paper's year after the journal, as the card on the share screen
-- does. promote_showcase stores the paper's doi, journal, authors and link
-- already, but had no place for its year.
--
-- WHAT THIS DOES: adds promote_showcase.paper_year, an optional whole year.
-- Written only by the "Share a file" step (lib/server/showcase.ts:
-- shareFileItem). Nothing else reads or writes it.
--
-- Until this is run, the app keeps working: it reads and writes the item
-- without this column and the card simply shows no year.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run. NOT run
-- against any database as part of writing this file.
-- =============================================================================

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS paper_year SMALLINT;

ALTER TABLE public.promote_showcase
    DROP CONSTRAINT IF EXISTS promote_showcase_paper_year_range;
ALTER TABLE public.promote_showcase
    ADD CONSTRAINT promote_showcase_paper_year_range
        CHECK (paper_year IS NULL OR paper_year BETWEEN 1800 AND 2100);
