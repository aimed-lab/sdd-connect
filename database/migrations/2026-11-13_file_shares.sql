-- =============================================================================
-- Migration: file shares  (2026-11-13)
-- =============================================================================
-- WHY: shared files (datasets, slides, tools made on /share) move out of
-- Promote into their own home under /files. Promote stays a news feed.
-- They stay in the SAME table, promote_showcase; this flag is what tells the
-- two apart:
--   is_file_share = false  a Promote post, at /promote/<slug>, in the feed;
--   is_file_share = true   a file share, at /files/<slug>, never in the feed.
--
-- Only the "Share a file" step sets it (lib/server/showcase.ts: shareFileItem).
--
-- BACKFILL: items already made with "Share a file" before this column existed
-- are found by what only that flow produces: published, a real slug, NO body
-- text, and at least one attached file. The Promote editor cannot publish
-- without body text, and older pre-article rows have no attached files (the
-- files table came later), so neither matches.
--
-- POLICIES AND FUNCTIONS: none need to change. promote_showcase's existing
-- policies are row-level (published / owner) and cover the new column as they
-- cover every other one; showcase_owners() returns names only and does not
-- read this table's columns beyond owner_id.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run. NOT run
-- against any database as part of writing this file.
-- =============================================================================

ALTER TABLE public.promote_showcase
    ADD COLUMN IF NOT EXISTS is_file_share BOOLEAN NOT NULL DEFAULT false;

UPDATE public.promote_showcase s
   SET is_file_share = true
 WHERE s.is_file_share = false
   AND s.published = true
   AND s.slug IS NOT NULL
   AND btrim(s.article_body) = ''
   AND EXISTS (
       SELECT 1 FROM public.promote_showcase_media m WHERE m.showcase_id = s.id
   );

-- The two lists on /files and the Promote feed filter on this, newest first.
CREATE INDEX IF NOT EXISTS idx_promote_showcase_file_share
    ON public.promote_showcase (is_file_share, published, created_at DESC);
