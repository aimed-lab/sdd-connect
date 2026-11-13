"use client";

// "Share a file" — /share. One screen: drop a file, optionally link
// it to a paper, pick what it is, confirm, share. No AI step anywhere: the
// paper lookup is the plain metadata lookup (/api/promote/lookup), and the
// item is published straight away with the files as its content.
//
// The item row is created when the first file is dropped (same lazy draft as
// the submit flow), so the upload has a folder to go into. Sharing then fills
// in the title, type and paper and publishes it (shareFileAction). After that
// the same address shows the finish screen: the link, a Copy button and the
// QR code.
//
// Wording rule for this screen: plain words only. It never says "showcase",
// "media" or "submit".

import Link from "next/link";
import { useRef, useState } from "react";
import { createArticleDraftAction, shareFileAction } from "@/app/promote/actions";
import {
  FileDropArea,
  FileRows,
  KindChips,
  PaperPicker,
  TitleField,
  type Paper,
} from "@/components/promote/FileShareParts";
import PromoteQrCard from "@/components/promote/PromoteQrCard";
import { useFileUploads } from "@/components/promote/useFileUploads";
import { SITE_URL } from "@/lib/articleFormat";
import { itemPath, itemUrlFor } from "@/lib/server/promote/itemAddress";
import {
  SHARE_KIND_TYPE,
  guessShareKind,
  missingBeforeShare,
  paperForSave,
  prefillShareTitle,
  uploadingLabel,
  type ShareKind,
} from "@/lib/server/promote/quickShare";

/** Wrapper so "Share another file" starts again from a clean screen. */
export default function QuickShare() {
  const [round, setRound] = useState(0);
  const [shared, setShared] = useState<{ slug: string; title: string } | null>(null);

  if (shared) {
    return (
      <FinishScreen
        slug={shared.slug}
        title={shared.title}
        onAnother={() => {
          setShared(null);
          setRound((r) => r + 1);
        }}
      />
    );
  }
  return <ShareForm key={round} onShared={setShared} />;
}

function ShareForm({ onShared }: { onShared: (s: { slug: string; title: string }) => void }) {
  // What kind of file: guessed from the first file, one click to change.
  const [kind, setKind] = useState<ShareKind>("other");
  const kindChosen = useRef(false);
  const kindRef = useRef<ShareKind>("other");
  const [firstFileName, setFirstFileName] = useState<string | null>(null);
  const firstNameRef = useRef<string | null>(null);

  // The paper.
  const [paper, setPaper] = useState<Paper | null>(null);
  const [noPaper, setNoPaper] = useState(false);

  // Title: filled in for them until they type their own.
  const [titleTyped, setTitleTyped] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const ensureDraft = async (): Promise<string> => {
    const type = SHARE_KIND_TYPE[kindRef.current];
    const created = await createArticleDraftAction({
      type,
      title: prefillShareTitle({ kind: kindRef.current, paperTitle: null, firstFileName: firstNameRef.current }) || "File",
      headline: "",
      standfirst: "",
      articleBody: "",
      linkedinPost: "",
      authors: "",
      doi: null,
      link: null,
      journal: null,
      communityId: null,
    });
    // Plain words on this screen: never pass on the action's own wording
    // (it talks about drafts).
    if (!created.ok) {
      throw new Error(
        /sign in/i.test(created.error) ? "Sign in to share a file." : "Couldn't start the upload. Please try again."
      );
    }
    return created.id;
  };

  const uploads = useFileUploads({ ensureShowcaseId: ensureDraft, initialMedia: [] });

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!firstNameRef.current) {
      firstNameRef.current = files[0].name;
      setFirstFileName(files[0].name);
      if (!kindChosen.current) {
        const guess = guessShareKind(files[0].name);
        kindRef.current = guess;
        setKind(guess);
      }
    }
    uploads.addFiles(files);
  };

  const chooseKind = (k: ShareKind) => {
    kindChosen.current = true;
    kindRef.current = k;
    setKind(k);
  };

  const prefill = prefillShareTitle({ kind, paperTitle: paper?.title, firstFileName });
  const title = titleTyped ?? prefill;
  const missing = missingBeforeShare({
    filesReady: uploads.doneCount,
    uploading: uploads.pending,
    title,
    confirmed,
  });
  const canShare = !missing && !sharing;

  const share = async () => {
    const id = uploads.showcaseId();
    if (!canShare || !id) return;
    setSharing(true);
    setShareError(null);
    try {
      const res = await shareFileAction({
        id,
        type: SHARE_KIND_TYPE[kind],
        title,
        confirmed,
        paper: paperForSave(paper),
      });
      if (res.ok) onShared({ slug: res.slug, title: title.trim() });
      else setShareError(res.error);
    } catch {
      setShareError("Couldn't share this file. Please try again.");
    } finally {
      setSharing(false);
    }
  };

  const buttonText = sharing
    ? "Sharing…"
    : uploads.pending
      ? uploadingLabel(uploads.progress.sent, uploads.progress.total)
      : "Share";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-headline-lg text-[28px] md:text-[32px] leading-tight text-on-background">Share a file</h1>
        <p className="mt-1 font-body-md text-body-md text-secondary">
          Upload a dataset, slides or a tool. You get a link you can send to anyone.
        </p>
      </header>

      {/* Files */}
      <div>
        <FileDropArea hasFiles={uploads.items.length > 0} onFiles={addFiles} />
        <FileRows uploads={uploads} />
      </div>

      <PaperPicker paper={paper} onPaper={setPaper} noPaper={noPaper} onNoPaper={setNoPaper} />

      <KindChips kind={kind} onChoose={chooseKind} />

      <TitleField value={title} onChange={setTitleTyped} />

      {/* Confirmation */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <span className="font-body-sm text-body-sm text-on-background">
          This file has no patient or private data, and I have the right to share it.
        </span>
      </label>

      {/* Share */}
      <div>
        <p className="mb-2 font-body-sm text-body-sm text-secondary text-center">
          Visible to everyone. Anyone with the link can download it.
        </p>
        <button
          type="button"
          onClick={share}
          disabled={!canShare}
          className="btn-primary w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonText}
        </button>
        {missing && !uploads.pending && (
          <p className="mt-1.5 font-body-sm text-body-sm text-secondary text-center">{missing}</p>
        )}
        {shareError && (
          <p className="mt-1.5 font-body-sm text-body-sm text-error text-center" role="alert">
            {shareError}
          </p>
        )}
      </div>
    </div>
  );
}

function FinishScreen({ slug, title, onAnother }: { slug: string; title: string; onAnother: () => void }) {
  // A file share lives at /files/<slug>: the link, Copy and the QR all use it.
  const url = itemUrlFor(SITE_URL, slug, true);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <span className="material-symbols-outlined text-4xl text-primary">check_circle</span>
        <h1 className="mt-2 font-headline-lg text-[28px] md:text-[32px] leading-tight text-on-background">
          Your file is live
        </h1>
        <p className="mt-1 font-body-md text-body-md text-secondary">
          Anyone with this link can view and download it.
        </p>
        <p className="mt-1 font-label-md text-label-md text-on-background">{title}</p>
      </header>

      <div>
        <label htmlFor="share-link" className="block font-label-md text-label-md text-on-background">
          Link
        </label>
        <div className="mt-1.5 flex flex-col sm:flex-row gap-2">
          <input
            id="share-link"
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full min-w-0 rounded-md border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 font-body-sm text-body-sm text-on-background"
          />
          <button
            type="button"
            onClick={copy}
            className="btn-outline shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined text-base">{copied ? "check" : "content_copy"}</span>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xs">
        <PromoteQrCard url={url} slug={slug} title={title} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          href={itemPath(slug, true)}
          className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
        >
          View page
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="btn-outline inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
        >
          Share another file
        </button>
      </div>
    </div>
  );
}
