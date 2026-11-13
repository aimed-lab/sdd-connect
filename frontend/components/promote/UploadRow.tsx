"use client";

// One file in an upload list (MediaUploader.tsx, QuickShare.tsx): name, size,
// a progress bar while it uploads, Remove (or Cancel), Resume / Try again,
// and the one-line label field. The label can be typed while the file is
// still uploading; it is saved once the file is in (useFileUploads.ts).

import { MAX_MEDIA_LABEL_CHARS, formatFileSize } from "@/lib/server/promote/mediaFiles";
import type { UploadItem } from "@/components/promote/useFileUploads";

const KIND_ICON: Record<string, string> = {
  image: "image",
  slides: "slideshow",
  file: "description",
};

export default function UploadRow({
  item,
  labelPlaceholder,
  onLabelChange,
  onLabelCommit,
  onRemove,
  onResume,
}: {
  item: UploadItem;
  labelPlaceholder: string;
  onLabelChange: (value: string) => void;
  onLabelCommit: () => void;
  onRemove: () => void;
  onResume: () => void;
}) {
  const done = item.status === "done";
  const pct = item.size > 0 ? Math.min(100, Math.round((item.sent / item.size) * 100)) : 0;
  const icon = done && item.media ? KIND_ICON[item.media.kind] ?? "description" : "upload_file";

  return (
    <li className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-primary text-base shrink-0">{icon}</span>
          <span className="font-body-sm text-body-sm text-on-background truncate">{item.name}</span>
          <span className="font-label-sm text-label-sm text-secondary shrink-0">
            {done
              ? formatFileSize(item.size)
              : item.status === "saving"
                ? "Finishing…"
                : `${formatFileSize(item.sent)} of ${formatFileSize(item.size)}`}
          </span>
        </span>
        <span className="flex items-center gap-4 shrink-0">
          {(item.status === "paused" || item.status === "failed") && (
            <button
              type="button"
              onClick={onResume}
              className="font-label-sm text-label-sm text-primary hover:underline"
            >
              {item.status === "paused" ? "Resume" : "Try again"}
            </button>
          )}
          {item.status !== "saving" && (
            <button type="button" onClick={onRemove} className="font-label-sm text-label-sm text-error hover:underline">
              {done ? "Remove" : "Cancel"}
            </button>
          )}
        </span>
      </div>

      {!done && (
        <div
          className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden"
          role="progressbar"
          aria-label={`Uploading ${item.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className={`h-full rounded-full transition-all ${
              item.status === "failed" ? "bg-error" : item.status === "paused" ? "bg-secondary" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {item.message && (
        <p
          className={`font-body-sm text-body-sm ${item.status === "failed" ? "text-error" : "text-secondary"}`}
          role={item.status === "failed" ? "alert" : undefined}
        >
          {item.message}
        </p>
      )}

      {item.status !== "failed" && (
        <div>
          <label className="sr-only" htmlFor={`file-label-${item.key}`}>
            Label for {item.name}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`file-label-${item.key}`}
              type="text"
              value={item.label}
              maxLength={MAX_MEDIA_LABEL_CHARS}
              placeholder={labelPlaceholder}
              onChange={(e) => onLabelChange(e.target.value)}
              onBlur={onLabelCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              className="w-full min-w-0 rounded-md border border-outline-variant/50 bg-surface px-3 py-1.5 font-body-sm text-body-sm text-on-background placeholder:text-secondary/70"
            />
            <span className="font-label-sm text-label-sm text-secondary shrink-0 w-14 text-right">
              {item.labelState === "saving" ? "Saving…" : item.labelState === "saved" ? "Saved" : ""}
            </span>
          </div>
          {item.labelError && (
            <p className="mt-1 font-body-sm text-body-sm text-error" role="alert">
              {item.labelError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
