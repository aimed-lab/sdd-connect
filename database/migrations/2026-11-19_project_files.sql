-- =============================================================================
-- Migration: project_files — CORE  (2026-11-19)   [RUN THIS FIRST]
-- =============================================================================
-- WHY: project members share files (slides, PDFs, documents, spreadsheets,
-- images) inside a project, on the project's Files tab. Only members of that
-- project can see, open or add them.
--
-- HOW A FILE GETS IN: the browser uploads it straight to the private
-- project-files bucket (resumable TUS upload, as the signed-in member; see
-- 2026-11-19_project_files_storage.sql). Then the server checks the object in
-- Storage (folder, size, type) and writes one row here
-- (lib/server/projectFiles.ts: recordProjectFile). The bytes never pass
-- through a Server Action.
--
-- WHO MAY DO WHAT (the same rules as the storage policies):
--   SELECT  any member of the project (a project_members row).
--   INSERT  any member of the project, as themselves (added_by = caller).
--   DELETE  the member who shared the file, or a project lead or manager.
--   UPDATE  nobody: there is no UPDATE policy, so a row never changes.
--
-- Membership is public.is_project_member() (2026-08-04_projects.sql) and
-- lead-or-manager is public.is_project_staff()
-- (2026-10-27_project_manager_role.sql). Both are SECURITY DEFINER and are
-- granted to `authenticated` only; anon has no access to this table at all.
--
-- added_by is ON DELETE SET NULL, not CASCADE: a file belongs to the project,
-- so it stays when the person who shared it deletes their account. A lead or
-- manager can still remove it.
--
-- Touches ONLY the `public` schema, so it cannot fail on storage permissions.
-- Kept apart from the bucket and storage policies for the usual reason: the
-- SQL editor runs a script as one transaction, and a refused
-- `CREATE POLICY ... ON storage.objects` would roll this table back too.
--
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run. NOT run
-- against any database as part of writing this file.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.project_files (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    added_by     UUID                 REFERENCES public.users (id) ON DELETE SET NULL,
    -- The storage OBJECT PATH in the private project-files bucket,
    -- `<project_id>/<uuid>-<clean name>`. Never a URL: the bucket has no
    -- public read, so every open goes through /projects/<id>/files/<file id>,
    -- which mints a 60-second signed URL.
    path         TEXT        NOT NULL UNIQUE,
    -- The original name, shown in the list and used as the download name.
    filename     TEXT        NOT NULL,
    -- Optional title; the list shows the filename when it is empty.
    title        TEXT,
    -- Read from Storage when the row is written, never from the browser.
    size_bytes   BIGINT      NOT NULL,
    content_type TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_files_path_in_project_folder
        CHECK (split_part(path, '/', 1) = project_id::text),
    CONSTRAINT project_files_size_check
        CHECK (size_bytes > 0 AND size_bytes <= 52428800), -- 50 MB
    CONSTRAINT project_files_filename_check
        CHECK (char_length(filename) BETWEEN 1 AND 200),
    CONSTRAINT project_files_title_check
        CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_project_files_project
    ON public.project_files (project_id, created_at DESC);

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

-- No anon access at all. Signed-in users get read, insert and delete; the
-- policies below decide which rows. No UPDATE privilege: rows never change.
REVOKE ALL ON public.project_files FROM anon;
REVOKE ALL ON public.project_files FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.project_files TO authenticated;

-- Read: any member of the project.
DROP POLICY IF EXISTS "Project files: member select" ON public.project_files;
CREATE POLICY "Project files: member select"
    ON public.project_files FOR SELECT
    TO authenticated
    USING (public.is_project_member(project_id, auth.uid()));

-- Add: any member of the project, as themselves, into the project's folder
-- (the folder rule is also the CHECK constraint above).
DROP POLICY IF EXISTS "Project files: member insert" ON public.project_files;
CREATE POLICY "Project files: member insert"
    ON public.project_files FOR INSERT
    TO authenticated
    WITH CHECK (
        added_by = auth.uid()
        AND public.is_project_member(project_id, auth.uid())
        AND split_part(path, '/', 1) = project_id::text
    );

-- Remove: the member who shared it (while still a member), or a project lead
-- or manager.
DROP POLICY IF EXISTS "Project files: uploader or staff delete" ON public.project_files;
CREATE POLICY "Project files: uploader or staff delete"
    ON public.project_files FOR DELETE
    TO authenticated
    USING (
        (added_by = auth.uid() AND public.is_project_member(project_id, auth.uid()))
        OR public.is_project_staff(project_id, auth.uid())
    );

-- A SECURITY DEFINER function used inside a policy still needs the calling
-- role's EXECUTE grant. Both already have it from their own migrations;
-- restated so this file stands on its own (GRANT is idempotent).
GRANT EXECUTE ON FUNCTION public.is_project_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_staff(UUID, UUID) TO authenticated;
