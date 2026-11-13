-- =============================================================================
-- Migration: Promote files  (2026-11-13)
-- =============================================================================
-- WHY: a Promote item can carry any file (CSV, Parquet, ZIP, MP4...), not only
-- images and slide decks, and each file can have a one-line label such as
-- "External evaluation set used in Table 3".
--
-- WHAT THIS DOES
--   1. promote_showcase_media.kind also allows 'file'. 'image' and 'slides'
--      stay exactly as they are; no existing row changes.
--   2. promote_showcase_media.label: optional text, at most 200 characters.
--   3. The owner can change the LABEL of their own file, and nothing else.
--      Before this file the table had no UPDATE policy at all (rows were only
--      inserted and deleted), so editing a label needs one. The column grant
--      keeps it to the label: the row's url (the storage path), kind, size and
--      owner can still never be changed after insert.
--
-- NOT IN THIS FILE: any storage bucket change. The showcase-media bucket's size
-- limit and allowed file types are changed by hand in the Supabase dashboard
-- (see the build notes). Until that is done, uploads of new file types are
-- refused by the bucket itself, and nothing else breaks.
--
-- Needs: 2026-09-06_promote_media.sql (the table). Run once in the Supabase SQL
-- editor. Idempotent: safe to re-run. NOT run against any database as part of
-- writing this file.
-- =============================================================================

-- ── 1. kind: 'image' | 'slides' | 'file' ────────────────────────────────────
-- The original CHECK was written inline and unnamed, so Postgres named it
-- promote_showcase_media_kind_check. Drop that name, add it back named.
ALTER TABLE public.promote_showcase_media
    DROP CONSTRAINT IF EXISTS promote_showcase_media_kind_check;
ALTER TABLE public.promote_showcase_media
    ADD CONSTRAINT promote_showcase_media_kind_check
        CHECK (kind IN ('image', 'slides', 'file'));

-- ── 2. label ────────────────────────────────────────────────────────────────
ALTER TABLE public.promote_showcase_media
    ADD COLUMN IF NOT EXISTS label TEXT;

ALTER TABLE public.promote_showcase_media
    DROP CONSTRAINT IF EXISTS promote_showcase_media_label_length;
ALTER TABLE public.promote_showcase_media
    ADD CONSTRAINT promote_showcase_media_label_length
        CHECK (label IS NULL OR char_length(label) <= 200);

-- ── 3. owner may update the label only ──────────────────────────────────────
-- Column-level privilege: authenticated may UPDATE the label column and no
-- other. (anon never had a write path here.) REVOKE first so re-running this
-- file leaves exactly this grant.
REVOKE UPDATE ON public.promote_showcase_media FROM authenticated;
REVOKE UPDATE ON public.promote_showcase_media FROM anon;
GRANT UPDATE (label) ON public.promote_showcase_media TO authenticated;

-- Row-level: only the file's owner, and only while they still own the item.
DROP POLICY IF EXISTS "promote_showcase_media_update_own_label" ON public.promote_showcase_media;
CREATE POLICY "promote_showcase_media_update_own_label"
    ON public.promote_showcase_media FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        auth.uid() = owner_id
        AND EXISTS (
            SELECT 1 FROM public.promote_showcase s
            WHERE s.id = showcase_id AND s.owner_id = auth.uid()
        )
    );
