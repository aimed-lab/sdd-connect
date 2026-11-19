"use client";

// Direct, resumable file uploads for a Promote item, shared by the editor's
// Media section (MediaUploader.tsx), the "Share a file" screen
// (QuickShare.tsx) and the file manager (ManageFile.tsx).
//
// The upload itself (TUS straight from the browser to Storage, retries,
// resume, progress, labels) lives in components/uploads/useResumableUploads.ts,
// shared with project files. This file only supplies what is specific to a
// Promote item: the private showcase-media bucket, the item's folder
// (`<showcase_id>/<uuid>-<clean name>`), the resume key, and the record /
// remove / label actions. When an upload completes, recordShowcaseMediaAction
// checks the object in Storage and writes the row; a label typed meanwhile is
// saved right after with updateShowcaseMediaLabelAction.
//
// The item row itself is created lazily: `ensureShowcaseId` runs only when
// the first file is picked, and only once (single-flight), so opening a page
// never creates a draft on its own.

import {
  recordShowcaseMediaAction,
  removeShowcaseMediaAction,
  updateShowcaseMediaLabelAction,
} from "@/app/promote/actions";
import { buildMediaObjectPath, isMediaObjectPathFor } from "@/lib/server/promote/mediaFiles";
import type { ShowcaseMedia } from "@/lib/showcaseTypes";
import {
  useResumableUploads,
  type UploadItem as GenericUploadItem,
} from "@/components/uploads/useResumableUploads";

export type { LabelState, UploadStatus } from "@/components/uploads/useResumableUploads";
export type UploadItem = GenericUploadItem<ShowcaseMedia>;

const BUCKET = "showcase-media";

export function useFileUploads({
  ensureShowcaseId,
  initialMedia,
}: {
  ensureShowcaseId: () => Promise<string>;
  initialMedia: ShowcaseMedia[];
}) {
  const uploads = useResumableUploads<ShowcaseMedia>({
    bucket: BUCKET,
    resumeKey: "promote-media",
    ensureParentId: ensureShowcaseId,
    initialMedia,
    buildPath: buildMediaObjectPath,
    isPathFor: isMediaObjectPathFor,
    // The label is saved separately (updateLabel), right after the row.
    record: ({ parentId, path, filename }) => recordShowcaseMediaAction({ showcaseId: parentId, path, filename }),
    remove: removeShowcaseMediaAction,
    updateLabel: updateShowcaseMediaLabelAction,
  });
  const { parentId, dismiss: _dismiss, ...rest } = uploads;
  void _dismiss;
  return { ...rest, showcaseId: parentId };
}
