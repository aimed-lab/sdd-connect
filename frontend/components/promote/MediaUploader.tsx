"use client";

// The Media section: attach/remove files and label them. Two callers:
//   - components/promote/SubmitFlow.tsx's manual form — there is NO row yet
//     when this mounts (a row is created lazily, on first input anywhere in
//     the form). `ensureShowcaseId` is how this gets one on demand: it's
//     called only when a file is actually picked, not on mount, so opening
//     the submit page never creates a draft on its own.
//   - components/promote/ArticleEditor.tsx — editing an entry that already
//     exists (paper path post-generation, or the edit route); its
//     `ensureShowcaseId` is trivial, just resolving to that id.
//
// The upload itself (direct to Storage, resumable, then recorded server
// side) lives in useFileUploads.ts, shared with the "Share a file" screen.
//
// Any file type is accepted. Images (PNG, JPEG, WebP, GIF) are shown in the
// article; PDF/PPTX stay "slides"; everything else is a "file". Slides and
// files are listed on the item page for download only.

import { useRef } from "react";
import UploadRow from "@/components/promote/UploadRow";
import { useFileUploads } from "@/components/promote/useFileUploads";
import { MAX_MEDIA_BYTES, formatFileSize } from "@/lib/server/promote/mediaFiles";
import type { ShowcaseMedia, ShowcaseType } from "@/lib/showcaseTypes";

const MEDIA_HINT: Record<ShowcaseType, string> = {
  paper: "A figure, chart, or a copy of the poster or slides, if you have one.",
  preprint: "A figure or chart from the preprint, if you have one.",
  talk: "Upload your slides or a photo from the session.",
  poster: "Upload the poster as an image or PDF.",
  event: "Upload the flyer or a photo, if you have one.",
  achievement: "A photo of the award, plaque, or moment.",
  breakthrough: "A figure or image that shows the result.",
  partnership: "A photo or logo of the partners, if you have one.",
  funding: "A photo of the team, or the funder's logo.",
  tool: "Screenshots or a demo.",
  service: "A photo of the facility or a sample report.",
  dataset: "A figure or screenshot that shows what is in it.",
  other: "Anything that helps show what this is.",
};

export default function MediaUploader({
  ensureShowcaseId,
  type,
  initialMedia,
}: {
  /** Resolves to the showcase_id to upload against, creating the draft row
   *  first if one doesn't exist yet. Called lazily — only when a file is
   *  actually picked — and only once. Throws if the row can't be
   *  created/found, which becomes a normal error message. */
  ensureShowcaseId: () => Promise<string>;
  /** Drives only the helper text's lead sentence — reactive, so changing
   *  the Type dropdown in ArticleEditor (or SubmitFlow's manual form)
   *  updates the hint immediately. */
  type: ShowcaseType;
  initialMedia: ShowcaseMedia[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const uploads = useFileUploads({ ensureShowcaseId, initialMedia });

  const pickFiles = (files: FileList | null) => {
    uploads.addFiles(Array.from(files ?? []));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <section className="glass-panel rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="font-headline-md text-lg text-on-background">Media</h2>
        <p className="mt-1 font-body-sm text-body-sm text-secondary">
          {MEDIA_HINT[type]} Any file type, up to {formatFileSize(MAX_MEDIA_BYTES)} each. Images
          appear in the article; other files are listed for download.
        </p>
      </div>

      {uploads.items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {uploads.items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              labelPlaceholder="Optional label, e.g. External evaluation set used in Table 3"
              onLabelChange={(v) => uploads.setLabel(item.key, v)}
              onLabelCommit={() => uploads.commitLabel(item.key)}
              onRemove={() => void uploads.remove(item.key)}
              onResume={() => uploads.resume(item.key)}
            />
          ))}
        </ul>
      )}

      {uploads.error && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {uploads.error}
        </p>
      )}

      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-outline-variant/50 rounded-xl py-8 cursor-pointer hover:bg-surface-container-low transition-all">
        <span className="material-symbols-outlined text-2xl text-primary">
          {uploads.busy ? "hourglass_top" : "upload"}
        </span>
        <span className="font-label-md text-label-md text-on-background">
          {uploads.busy ? "Uploading… you can add more" : "Add a file"}
        </span>
        <input ref={fileRef} type="file" multiple onChange={(e) => pickFiles(e.target.files)} className="sr-only" />
      </label>
    </section>
  );
}
