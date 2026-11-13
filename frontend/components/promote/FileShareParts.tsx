"use client";

// The pieces of the file sharing screens, shared by "Share a file" (/share,
// QuickShare.tsx) and "Manage file" (/files/<slug>/edit, ManageFile.tsx), so
// both look and read the same: the drop area, the file rows, the paper field
// and card, the four type chips and the title field.
//
// Wording rule: plain words only. Never "showcase", "media", "submit",
// "publish" or "draft".

import { useRef, useState } from "react";
import ConfirmDialog from "@/components/promote/ConfirmDialog";
import UploadRow from "@/components/promote/UploadRow";
import type { useFileUploads } from "@/components/promote/useFileUploads";
import { MAX_MEDIA_BYTES, formatFileSize } from "@/lib/server/promote/mediaFiles";
import { REMOVE_FILE_CONFIRM, removeNeedsConfirm } from "@/lib/server/promote/manageFile";
import { parsePaperInput } from "@/lib/server/promote/paperInput";
import {
  SHARE_KINDS,
  SHARE_KIND_LABEL,
  paperDetailsLine,
  paperYear,
  shortAuthors,
  type ScreenPaper,
  type ShareKind,
} from "@/lib/server/promote/quickShare";

/** A paper as the screens hold it (the lookup's answer, or what is stored). */
export type Paper = ScreenPaper;

const PAPER_NOT_FOUND = "We couldn't find that paper. Check the link, or continue without it.";

/** The big drop area. "Drop your file here, or choose a file". */
export function FileDropArea({ hasFiles, onFiles }: { hasFiles: boolean; onFiles: (files: File[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
      className={`w-full flex flex-col items-center justify-center gap-1.5 border-2 border-dashed rounded-xl cursor-pointer transition-all text-center px-4 ${
        hasFiles ? "py-4" : "py-9"
      } ${dragging ? "border-primary bg-primary/5" : "border-outline-variant/60 hover:bg-surface-container-low"}`}
    >
      <span className="material-symbols-outlined text-3xl text-primary">upload_file</span>
      <span className="font-label-md text-label-md text-on-background">
        {hasFiles ? "Drop another file, or " : "Drop your file here, or "}
        <span className="text-primary underline underline-offset-4">choose a file</span>
      </span>
      <span className="font-body-sm text-body-sm text-secondary">
        Any type, up to {formatFileSize(MAX_MEDIA_BYTES)} each
      </span>
      <input ref={fileRef} type="file" multiple onChange={(e) => take(e.target.files)} className="sr-only" />
    </label>
  );
}

/** The file rows under the drop area: name, size, progress, label, Remove.
 *  Removing a file that has finished uploading asks first (in-page, never a
 *  browser dialog); a file still uploading is cancelled straight away. */
export function FileRows({
  uploads,
  onRemove,
  beforeRemove,
  extraError,
}: {
  uploads: ReturnType<typeof useFileUploads>;
  /** Defaults to removing the file. */
  onRemove?: (key: string) => void | Promise<void>;
  /** Checked before asking; return false to stop (the screen shows why). */
  beforeRemove?: (key: string) => boolean;
  /** A message from the screen itself, shown with the upload errors. */
  extraError?: string | null;
}) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const error = extraError ?? uploads.error;
  const remove = (key: string) => (onRemove ? onRemove(key) : uploads.remove(key));

  const askRemove = (key: string) => {
    if (beforeRemove && !beforeRemove(key)) return;
    const row = uploads.items.find((j) => j.key === key);
    if (row && removeNeedsConfirm(row.status)) setConfirmKey(key);
    else void remove(key);
  };

  return (
    <>
      {uploads.items.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {uploads.items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              labelPlaceholder="What is this file? (optional)"
              onLabelChange={(v) => uploads.setLabel(item.key, v)}
              onLabelCommit={() => uploads.commitLabel(item.key)}
              onRemove={() => askRemove(item.key)}
              onResume={() => uploads.resume(item.key)}
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 font-body-sm text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
      {confirmKey && (
        <ConfirmDialog
          heading={REMOVE_FILE_CONFIRM.heading}
          message={REMOVE_FILE_CONFIRM.message}
          confirmLabel={REMOVE_FILE_CONFIRM.confirm}
          onConfirm={() => remove(confirmKey)}
          onClose={() => setConfirmKey(null)}
        />
      )}
    </>
  );
}

/** "Which paper is this from?": one field for a DOI, doi.org link, PubMed ID
 *  or PubMed link, looked up on paste or blur (no AI), shown as a small card
 *  with Remove; "No paper" skips it. A failed lookup never blocks anything. */
export function PaperPicker({
  paper,
  onPaper,
  noPaper,
  onNoPaper,
}: {
  paper: Paper | null;
  onPaper: (paper: Paper | null) => void;
  noPaper: boolean;
  onNoPaper: (noPaper: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLookup = useRef("");
  const lookupSeq = useRef(0);

  const lookUp = async (raw: string) => {
    const text = raw.trim();
    if (!text || text === lastLookup.current) return;
    lastLookup.current = text;
    setError(null);
    if (!parsePaperInput(text)) {
      onPaper(null);
      setError(PAPER_NOT_FOUND);
      return;
    }
    const seq = ++lookupSeq.current;
    setLookingUp(true);
    try {
      const res = await fetch("/api/promote/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text }),
      });
      if (seq !== lookupSeq.current) return;
      if (!res.ok) throw new Error("not found");
      const data = (await res.json()) as Paper;
      if (!data?.title) throw new Error("not found");
      onPaper({
        title: data.title,
        authors: Array.isArray(data.authors) ? data.authors : [],
        journal: data.journal ?? null,
        doi: data.doi ?? null,
        publishedDate: data.publishedDate ?? null,
        sourceUrl: data.sourceUrl,
      });
    } catch {
      if (seq !== lookupSeq.current) return;
      onPaper(null);
      setError(PAPER_NOT_FOUND);
    } finally {
      if (seq === lookupSeq.current) setLookingUp(false);
    }
  };

  const clear = () => {
    lookupSeq.current++;
    lastLookup.current = "";
    onPaper(null);
    setInput("");
    setError(null);
    setLookingUp(false);
  };

  return (
    <div>
      <label htmlFor="share-paper" className="block font-label-md text-label-md text-on-background">
        Which paper is this from?
      </label>
      {noPaper ? (
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          No paper.{" "}
          <button
            type="button"
            onClick={() => onNoPaper(false)}
            className="text-primary hover:underline underline-offset-4"
          >
            Add a paper
          </button>
        </p>
      ) : paper ? (
        <div className="mt-1.5 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3">
          <p className="font-label-md text-label-md text-on-background">{paper.title}</p>
          <p className="mt-0.5 font-body-sm text-body-sm text-secondary">
            {paperDetailsLine(shortAuthors(paper.authors), paper.journal, paperYear(paper.publishedDate))}
          </p>
          <button type="button" onClick={clear} className="mt-1 font-label-sm text-label-sm text-error hover:underline">
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="mt-1.5 flex items-center gap-3">
            <input
              id="share-paper"
              type="text"
              inputMode="url"
              value={input}
              placeholder="DOI, doi.org link, PubMed ID or PubMed link"
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text) {
                  e.preventDefault();
                  setInput(text.trim());
                  void lookUp(text);
                }
              }}
              onBlur={() => void lookUp(input)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void lookUp(input);
                }
              }}
              className="w-full min-w-0 rounded-md border border-outline-variant/50 bg-surface px-3 py-2 font-body-sm text-body-sm text-on-background placeholder:text-secondary/70"
            />
            <button
              type="button"
              onClick={() => {
                clear();
                onNoPaper(true);
              }}
              className="shrink-0 font-label-sm text-label-sm text-primary hover:underline underline-offset-4"
            >
              No paper
            </button>
          </div>
          {lookingUp && <p className="mt-1 font-body-sm text-body-sm text-secondary">Looking up the paper…</p>}
          {error && <p className="mt-1 font-body-sm text-body-sm text-secondary">{error}</p>}
        </>
      )}
    </div>
  );
}

/** "What is it?": Dataset, Slides, Tool, Other. */
export function KindChips({ kind, onChoose }: { kind: ShareKind; onChoose: (kind: ShareKind) => void }) {
  return (
    <div>
      <p className="font-label-md text-label-md text-on-background" id="share-kind">
        What is it?
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="share-kind">
        {SHARE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => onChoose(k)}
            className={`px-4 py-1.5 rounded-full font-label-md text-label-md transition-all ${
              kind === k
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-secondary hover:bg-surface-container hover:text-primary"
            }`}
          >
            {SHARE_KIND_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The title field. */
export function TitleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor="share-title" className="block font-label-md text-label-md text-on-background">
        Title
      </label>
      <input
        id="share-title"
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-outline-variant/50 bg-surface px-3 py-2 font-body-md text-body-md text-on-background"
      />
    </div>
  );
}
