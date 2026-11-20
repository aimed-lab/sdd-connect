"use client";

// "Shared files" on a project's Files tab (ordinary and CollaboFest projects).
// Members share images, PDFs and Office files up to 50 MB; only members of
// the project can see or open them.
//
// Uploads go straight from the browser to the private project-files bucket
// (components/uploads/useResumableUploads.ts, resumable TUS), so a 30 MB deck
// works; recordProjectFileAction then checks the object and writes the row.
// Each file opens through its stable members-only link
// (/projects/<id>/files/<file id>), never a storage URL in the page.
// The rules (types, paths, who may remove) are lib/server/projectFileRules.ts;
// RLS enforces the same ones.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/promote/ConfirmDialog";
import UploadRow from "@/components/promote/UploadRow";
import { useResumableUploads } from "@/components/uploads/useResumableUploads";
import { recordProjectFileAction, removeProjectFileAction, type ProjectUploadMedia } from "@/app/projects/[id]/actions";
import { formatFileSize } from "@/lib/server/promote/mediaFiles";
import {
  buildProjectFilePath,
  checkProjectFileType,
  isProjectFilePathFor,
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_KIND_STYLE,
  PROJECT_FILES_BUCKET,
  projectFileProblem,
  sharedDateLabel,
} from "@/lib/server/projectFileRules";
import type { ProjectFile } from "@/lib/server/projectFiles";

export default function ProjectFilesSection({
  projectId,
  files,
  loadError,
}: {
  projectId: string;
  files: ProjectFile[];
  /** Set when the list couldn't be read (shown instead of the empty state). */
  loadError?: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** The file whose Remove is waiting for confirmation (ConfirmDialog). */
  const [confirming, setConfirming] = useState<ProjectFile | null>(null);

  const uploads = useResumableUploads<ProjectUploadMedia>({
    bucket: PROJECT_FILES_BUCKET,
    resumeKey: "project-files",
    ensureParentId: async () => projectId,
    initialMedia: [],
    buildPath: buildProjectFilePath,
    isPathFor: isProjectFilePathFor,
    // The title typed while the file uploads goes in with the row.
    record: ({ parentId, path, filename, label }) =>
      recordProjectFileAction({ projectId: parentId, path, filename, title: label }),
    remove: removeProjectFileAction,
    checkFile: (f) => projectFileProblem(f.name, f.type, f.size),
    // Browsers report Office types inconsistently; upload with the standard
    // type for the extension (the bucket only accepts those).
    contentTypeFor: (f) => {
      const t = checkProjectFileType(f.name, f.type);
      return t.ok ? t.contentType : "application/octet-stream";
    },
    onRecorded: () => router.refresh(),
    forbiddenMessage: "You can't share files in this project. Check you're still a member, then sign in again.",
  });

  // A finished upload stays in the upload list only until the refreshed
  // list below includes it.
  const listed = new Set(files.map((f) => f.id));
  const uploadRows = uploads.items.filter((j) => !(j.status === "done" && j.media && listed.has(j.media.id)));

  const pick = (list: FileList | null) => {
    if (list && list.length > 0) uploads.addFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = async (f: ProjectFile) => {
    if (removing) return;
    setRemoving(f.id);
    setRemoveError(null);
    const res = await removeProjectFileAction(projectId, f.id);
    setRemoving(null);
    if (res.ok) router.refresh();
    else setRemoveError(res.error);
  };

  return (
    <section className="mb-20" aria-labelledby="project-files-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h2 id="project-files-heading" className="font-headline-md text-headline-md text-on-background">
            Shared files
          </h2>
          <p className="mt-1 font-body-md text-body-md text-secondary inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]" aria-hidden>
              lock
            </span>
            Only members of this project can see these files.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-primary inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg font-label-md text-label-md"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden>
            upload_file
          </span>
          Share a file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={PROJECT_FILE_ACCEPT}
          onChange={(e) => pick(e.target.files)}
          className="sr-only"
          aria-label="Choose files to share"
          tabIndex={-1}
        />
      </div>

      {uploads.error && (
        <p className="mb-4 font-body-sm text-body-sm text-error" role="alert">
          {uploads.error}
        </p>
      )}

      {uploadRows.length > 0 && (
        <ul className="mb-6 flex flex-col gap-3" aria-label="Uploads">
          {uploadRows.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              labelPlaceholder="Title (optional, the file name is used if empty)"
              onLabelChange={(v) => uploads.setLabel(item.key, v)}
              onLabelCommit={() => uploads.commitLabel(item.key)}
              onRemove={() => void uploads.remove(item.key)}
              onResume={() => uploads.resume(item.key)}
            />
          ))}
        </ul>
      )}

      {loadError ? (
        <p className="font-body-md text-body-md text-error" role="alert">
          {loadError}
        </p>
      ) : files.length === 0 ? (
        uploadRows.length === 0 && (
          <div className="rounded-xl border border-dashed border-outline-variant/60 px-6 py-10 flex flex-col items-center text-center gap-2">
            <span className="material-symbols-outlined text-secondary/70 text-[32px]" aria-hidden>
              folder_open
            </span>
            <p className="font-label-lg text-label-lg text-on-background">No files shared yet</p>
            <p className="font-body-sm text-body-sm text-secondary max-w-sm">
              Share slides, PDFs, documents, spreadsheets or images with your team. Each file can be up to 50 MB.
            </p>
          </div>
        )
      ) : (
        <ul className="divide-y divide-outline-variant/30 rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
          {files.map((f) => {
            const style = PROJECT_FILE_KIND_STYLE[f.kind];
            const meta = [f.sharedBy ? `Shared by ${f.sharedBy}` : null, sharedDateLabel(f.createdAt), formatFileSize(f.sizeBytes)]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={f.id} className={`flex items-center gap-3 px-4 py-3 ${removing === f.id ? "opacity-50" : ""}`}>
                <span
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center"
                  style={{ background: style.bg, color: style.fg }}
                  title={style.label}
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden>
                    {style.icon}
                  </span>
                  <span className="sr-only">{style.label}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-label-lg text-[15px] leading-6 font-semibold text-on-background break-words">{f.title}</p>
                  {f.title !== f.filename && (
                    <p className="text-[12.5px] leading-5 text-secondary break-all">{f.filename}</p>
                  )}
                  <p className="text-[12.5px] leading-5 text-secondary">{meta}</p>
                </div>
                <a
                  href={f.href}
                  className="shrink-0 font-label-md text-label-md text-primary border border-primary/40 hover:bg-primary hover:text-white rounded-lg px-3 py-1.5 transition-colors"
                  aria-label={`Open ${f.title}`}
                >
                  Open
                </a>
                {f.canRemove && (
                  <button
                    type="button"
                    onClick={() => setConfirming(f)}
                    disabled={removing === f.id}
                    className="shrink-0 font-label-md text-label-md text-error hover:underline disabled:opacity-50"
                    aria-label={`Remove ${f.title}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {removeError && (
        <p className="mt-3 font-body-sm text-body-sm text-error" role="alert">
          {removeError}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          heading="Remove this file?"
          message={`"${confirming.title}" will be removed from the project. Members will no longer be able to open it.`}
          confirmLabel="Remove file"
          onConfirm={() => removeFile(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
