"use client";

// "Manage file" — /files/<slug>/edit, for the owner of a file share. Looks and
// reads like "Share a file" (/share): the same column, the same parts
// (FileShareParts.tsx) and the same plain words. In order: the status line,
// the files, the paper, the type, the title, then Save changes, Hide / Make
// public and, set apart, Delete. Nothing else: no share texts, no article
// fields, no community, no AI.
//
// Wording rule: "Public" and "Hidden", "Make public" and "Hide". Never
// "Published", "Unpublished", "Draft" or "Publish".

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { setFileSharePublicAction, updateFileShareAction } from "@/app/promote/actions";
import DeleteItemButton from "@/components/promote/DeleteItemButton";
import {
  FileDropArea,
  FileRows,
  KindChips,
  PaperPicker,
  TitleField,
  type Paper,
} from "@/components/promote/FileShareParts";
import { useFileUploads } from "@/components/promote/useFileUploads";
import { itemEditPath } from "@/lib/server/promote/itemAddress";
import { canRemoveFile, fileStatusLine, visibilityButtonLabel } from "@/lib/server/promote/manageFile";
import {
  SHARE_KIND_TYPE,
  paperForSave,
  paperFromStored,
  shareKindForType,
  uploadingLabel,
  type ShareKind,
} from "@/lib/server/promote/quickShare";
import type { OwnedFileShare } from "@/lib/server/showcase";

type Snapshot = { kind: ShareKind; title: string; paperKey: string };

const paperKey = (p: Paper | null) => (p ? `${p.doi ?? ""}|${p.sourceUrl}|${p.title}` : "");

export default function ManageFile({ item }: { item: OwnedFileShare }) {
  const router = useRouter();
  const [slug, setSlug] = useState(item.slug);
  const [isPublic, setIsPublic] = useState(item.isPublic);

  const initialPaper = useMemo(() => paperFromStored(item.paper), [item.paper]);
  const [kind, setKind] = useState<ShareKind>(shareKindForType(item.type));
  const [title, setTitle] = useState(item.title);
  const [paper, setPaper] = useState<Paper | null>(initialPaper);
  const [noPaper, setNoPaper] = useState(false);
  const [saved, setSaved] = useState<Snapshot>({
    kind: shareKindForType(item.type),
    title: item.title,
    paperKey: paperKey(initialPaper),
  });

  const [busy, setBusy] = useState<"save" | "visibility" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const uploads = useFileUploads({ ensureShowcaseId: async () => item.id, initialMedia: item.media });

  const dirty = kind !== saved.kind || title.trim() !== saved.title.trim() || paperKey(paper) !== saved.paperKey;

  // Checked before the "Remove this file?" confirmation, so a file that may
  // not be removed is refused straight away instead of after asking.
  const mayRemove = (key: string): boolean => {
    setRemoveError(null);
    const row = uploads.items.find((j) => j.key === key);
    if (row?.status !== "done") return true; // cancelling an upload is always fine
    const allowed = canRemoveFile({ isPublic, hasBody: item.hasBody, fileCount: uploads.doneCount });
    if (!allowed.ok) setRemoveError(allowed.message);
    return allowed.ok;
  };

  const save = async (): Promise<boolean> => {
    setError(null);
    setMessage(null);
    if (!title.trim()) {
      setError("Add a title.");
      return false;
    }
    const res = await updateFileShareAction({
      id: item.id,
      type: SHARE_KIND_TYPE[kind],
      title,
      paper: paperForSave(paper),
    });
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setSaved({ kind, title: title.trim(), paperKey: paperKey(paper) });
    return true;
  };

  const onSave = async () => {
    setBusy("save");
    try {
      if (await save()) {
        setMessage("Changes saved.");
        router.refresh();
      }
    } catch {
      setError("Couldn't save your changes. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const onToggleVisibility = async () => {
    setBusy("visibility");
    setError(null);
    setMessage(null);
    try {
      if (dirty && !(await save())) return;
      const makePublic = !isPublic;
      if (makePublic && uploads.doneCount === 0) {
        setError("Add a file first.");
        return;
      }
      const res = await setFileSharePublicAction(item.id, slug, makePublic);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setIsPublic(makePublic);
      setRemoveError(null);
      setMessage(makePublic ? "This file is public now." : "This file is hidden now.");
      if (res.slug !== slug) {
        setSlug(res.slug);
        router.replace(itemEditPath(res.slug, true));
      } else {
        router.refresh();
      }
    } catch {
      setError("Couldn't change this. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || uploads.pending;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-headline-lg text-[28px] md:text-[32px] leading-tight text-on-background">Manage file</h1>
        <p className="mt-1 flex items-center gap-2 font-body-md text-body-md text-secondary" role="status">
          <span
            className={`material-symbols-outlined text-base ${isPublic ? "text-primary" : "text-secondary"}`}
            aria-hidden="true"
          >
            {isPublic ? "public" : "visibility_off"}
          </span>
          {fileStatusLine(isPublic)}
        </p>
      </header>

      {/* Files */}
      <div>
        <FileDropArea hasFiles={uploads.items.length > 0} onFiles={(files) => uploads.addFiles(files)} />
        <FileRows uploads={uploads} beforeRemove={mayRemove} extraError={removeError} />
      </div>

      <PaperPicker paper={paper} onPaper={setPaper} noPaper={noPaper} onNoPaper={setNoPaper} />

      <KindChips kind={kind} onChoose={setKind} />

      <TitleField value={title} onChange={setTitle} />

      {/* Buttons */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || !dirty}
            className="btn-primary w-full sm:w-auto sm:flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === "save" ? "Saving…" : uploads.pending ? uploadingLabel(uploads.progress.sent, uploads.progress.total) : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onToggleVisibility}
            disabled={disabled}
            className="btn-outline w-full sm:w-auto sm:flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {isPublic ? "visibility_off" : "public"}
            </span>
            {busy === "visibility" ? "One moment…" : visibilityButtonLabel(isPublic)}
          </button>
        </div>
        {message && (
          <p className="font-body-sm text-body-sm text-secondary text-center" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="font-body-sm text-body-sm text-error text-center" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Delete, set apart */}
      <div className="pt-5 border-t border-outline-variant/40 flex justify-end">
        <DeleteItemButton
          id={item.id}
          title={title || item.title}
          kind="file"
          afterDeleteHref="/files?deleted=1"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-error/40 text-error font-label-md text-label-md hover:bg-error/5"
        />
      </div>
    </div>
  );
}
