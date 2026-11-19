-- =============================================================================
-- Migration: project-files storage bucket + policies  (2026-11-19)
-- =============================================================================
-- Run AFTER 2026-11-19_project_files.sql.
--
-- SPLIT DELIBERATELY from the table migration: the Supabase SQL editor runs a
-- script as ONE transaction, and `CREATE POLICY ... ON storage.objects` fails
-- with "must be owner of table objects" on many projects, which would roll
-- the table back too.
--
-- IF THIS SCRIPT IS REFUSED, do the same in the dashboard:
--   1. Storage -> New bucket -> name: project-files -> Public bucket: OFF,
--      file size limit 50 MB, allowed MIME types: the list in section 1 below.
--   2. Storage -> Policies -> project-files -> New policy (for each, target
--      role `authenticated`), using the expressions in sections 2-4:
--        SELECT  members of the project in the first folder
--        INSERT  members of the project in the first folder
--        DELETE  the uploader (still a member), or a project lead or manager
-- Until the bucket exists, "Share a file" fails with a clear message and
-- nothing else breaks.
--
-- PRIVATE bucket: there is no public read and no anon policy. Every open goes
-- through /projects/<id>/files/<file id>, which checks membership and mints a
-- 60-second signed URL.
--
-- Object path convention: `<project_id>/<uuid>-<clean name>`. The project's id
-- is the first folder, which is what every policy keys on.
--
-- Idempotent: safe to re-run. NOT run against any database as part of writing
-- this file.
-- =============================================================================

-- ── 1. bucket ────────────────────────────────────────────────────────────────
-- Allowed types: images, PDF, PowerPoint, Word and Excel (old and new
-- formats). The app uploads with the standard type for the file's extension
-- (lib/server/projectFileRules.ts), because browsers report Office types
-- inconsistently, so these are the only types that ever arrive.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'project-files',
    'project-files',
    false,
    52428800, -- 50 MB
    ARRAY[
        'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
)
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = 52428800,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. read: members of the project ──────────────────────────────────────────
-- Needed to mint a signed URL (the server does that as the signed-in member)
-- and by the resumable upload itself.
DROP POLICY IF EXISTS "project_files_member_select" ON storage.objects;
CREATE POLICY "project_files_member_select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'project-files'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

-- ── 3. upload: members of the project, into the project's folder ─────────────
DROP POLICY IF EXISTS "project_files_member_insert" ON storage.objects;
CREATE POLICY "project_files_member_insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'project-files'
        AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
    );

-- ── 4. delete: the uploader (still a member), or a lead or manager ───────────
-- storage.objects.owner_id is the uploader's id as text.
DROP POLICY IF EXISTS "project_files_uploader_or_staff_delete" ON storage.objects;
CREATE POLICY "project_files_uploader_or_staff_delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'project-files'
        AND (
            (
                owner_id = auth.uid()::text
                AND public.is_project_member((storage.foldername(name))[1]::uuid, auth.uid())
            )
            OR public.is_project_staff((storage.foldername(name))[1]::uuid, auth.uid())
        )
    );

-- No UPDATE policy: an uploaded object is never overwritten (uploads send
-- x-upsert: false).

-- Same gotcha as every storage policy in this repo: the SECURITY DEFINER
-- helpers need the calling role's EXECUTE grant, or the policy errors.
GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_staff(UUID, UUID) TO authenticated;
