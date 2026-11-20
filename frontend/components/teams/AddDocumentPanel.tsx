"use client";

// "Share a document": a title, then a file or a link (or both). Reuses the
// community resource actions, so the same checks apply: http(s) links only,
// PNG / JPEG / WebP / GIF / PDF / PPTX files up to 50 MB, and in a team any
// member may add.
//
// The entry is created on submit, then the file uploads straight to Storage
// (useCommunityFileUploads, resumable) and the panel stays open with its
// progress (Cancel, Resume / Try again) until it is attached. If the upload is
// cancelled and the entry has no link, the entry just created is deleted again,
// so no empty titled entry is left behind.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createCommunityResourceAction, deleteCommunityResourceAction } from "@/app/communities/actions";
import UploadRow from "@/components/promote/UploadRow";
import { useCommunityFileUploads } from "@/components/communities/useCommunityFileUploads";
import { getResumableUploadTarget } from "@/lib/authClient";
import { COMMUNITY_FILE_ACCEPT, communityFileProblem, shouldDiscardNewResource } from "@/lib/server/communityFileRules";

const INPUT =
  "w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-4 py-2.5 font-body-md text-body-md text-on-background placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary";

export default function AddDocumentPanel({
  teamId,
  slug,
  onClose,
}: {
  teamId: string;
  slug: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // The entry this panel created, kept so a retry attaches to it instead of
  // creating a second one. Cleared when it is deleted again.
  const createdId = useRef<string | null>(null);
  const seenUpload = useRef(false);
  const closeWhenSettled = useRef(false);
  const uploads = useCommunityFileUploads(teamId);

  const pick = (list: FileList | null) => {
    setError(null);
    const f = list?.[0] ?? null;
    const problem = f ? communityFileProblem(f.name, f.type, f.size) : null;
    if (problem) {
      setError(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  // When the upload settles: attached -> done; cancelled (or refused before it
  // started) -> remove the entry again unless it has a link.
  useEffect(() => {
    if (!uploading) return;
    if (uploads.items.length > 0) seenUpload.current = true;
    const refusedEarly = !seenUpload.current && !!uploads.error;
    if (!refusedEarly && (!seenUpload.current || uploads.unfinished > 0)) return;

    setUploading(false);
    seenUpload.current = false;
    if (uploads.attached > 0) {
      router.refresh();
      onClose();
      return;
    }
    void (async () => {
      const id = createdId.current;
      const hasLink = !!url.trim();
      if (id && shouldDiscardNewResource({ createdHere: true, hasLink, attached: 0, stillUploading: 0 })) {
        const del = await deleteCommunityResourceAction(teamId, id, slug);
        if (del.ok) createdId.current = null;
        else console.error("AddDocumentPanel: couldn't remove the empty entry", del.error);
      } else if (hasLink) {
        router.refresh();
      }
      if (closeWhenSettled.current) {
        onClose();
        return;
      }
      setError(
        uploads.error ??
          (hasLink ? "Saved the link, but the file was not added." : "The upload was cancelled, so nothing was shared.")
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploading, uploads.items.length, uploads.unfinished, uploads.attached, uploads.error]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || uploading) return;
    if (!title.trim()) return setError("Give it a title.");
    if (!url.trim() && !file) return setError("Add a link or choose a file.");
    if (file) {
      // Everything that could refuse the file is checked BEFORE the entry exists.
      const problem = communityFileProblem(file.name, file.type, file.size);
      if (problem) return setError(problem);
      if (!getResumableUploadTarget()) return setError("Uploads aren't set up on this site.");
    }
    setBusy(true);
    setError(null);

    let id = createdId.current;
    if (!id) {
      const made = await createCommunityResourceAction(teamId, slug, {
        title,
        resource_type: url.trim() && !file ? "link" : "other",
        url,
        description: "",
      });
      if (!made.ok) {
        setError(made.error);
        setBusy(false);
        return;
      }
      id = made.id;
      createdId.current = id;
    }
    setBusy(false);

    if (!file) {
      router.refresh();
      onClose();
      return;
    }
    closeWhenSettled.current = false;
    setUploading(true);
    uploads.start(id, [file]);
  };

  const cancel = () => {
    if (!uploading) return onClose();
    // Stop the upload; the effect above removes the empty entry, then closes.
    closeWhenSettled.current = true;
    void uploads.cancelUnfinished();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        aria-label="Title"
        disabled={uploading}
        className={INPUT}
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link (https://…), if it lives online"
        aria-label="Link"
        disabled={uploading}
        className={INPUT}
      />
      {uploads.items.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Upload">
          {uploads.items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              onRemove={() => void uploads.remove(item.key)}
              onResume={() => uploads.resume(item.key)}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn-outline px-4 py-2 rounded-lg font-label-md text-label-md inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">attach_file</span>
            {file ? "Choose a different file" : "Choose a file"}
          </button>
          <input ref={fileRef} type="file" accept={COMMUNITY_FILE_ACCEPT} onChange={(e) => pick(e.target.files)} className="sr-only" />
          <span className="font-body-sm text-body-sm text-secondary">
            {file ? file.name : "PDF, PowerPoint or image, up to 50 MB."}
          </span>
        </div>
      )}
      {error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || uploading}
          className="btn-primary px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          {busy ? "Sharing…" : uploading ? "Uploading…" : "Share with the team"}
        </button>
        <button type="button" onClick={cancel} disabled={busy} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
      </div>
    </form>
  );
}
