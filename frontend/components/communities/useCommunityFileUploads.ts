"use client";

// Resumable uploads of files attached to a community or team resource, used by
// the community Resources form (ResourcesSection.tsx) and the team "Share a
// document" panel (components/teams/AddDocumentPanel.tsx).
//
// The shared useResumableUploads does the work: the browser uploads straight to
// the private community-resource-files bucket, into `<community_id>/...`, as the
// signed-in member (no Server Action body limit), then
// recordCommunityResourceFileAction checks the object and writes the row. The
// rules (types, size, path, the standard content type) are
// lib/server/communityFileRules.ts.
//
// The resource is created on submit, BEFORE the files go up, so `start` takes its
// id; the files' row needs it, the storage path does not (that is the community).

import { useRef } from "react";
import { recordCommunityResourceFileAction, removeCommunityResourceFileAction } from "@/app/communities/actions";
import { useResumableUploads, type UploadedMedia } from "@/components/uploads/useResumableUploads";
import {
  COMMUNITY_RESOURCE_FILES_BUCKET,
  buildCommunityFilePath,
  communityFileKind,
  communityFileProblem,
  communityUploadContentType,
  isCommunityFilePathFor,
} from "@/lib/server/communityFileRules";

export function useCommunityFileUploads(communityId: string, onRecorded?: () => void) {
  const resourceIdRef = useRef<string | null>(null);

  const uploads = useResumableUploads<UploadedMedia>({
    bucket: COMMUNITY_RESOURCE_FILES_BUCKET,
    resumeKey: "community-resource-files",
    ensureParentId: async () => communityId,
    initialMedia: [],
    buildPath: buildCommunityFilePath,
    isPathFor: isCommunityFilePathFor,
    record: async ({ parentId, path, filename }) => {
      const resourceId = resourceIdRef.current;
      if (!resourceId) return { ok: false, error: "Save the entry first, then add the file." };
      const res = await recordCommunityResourceFileAction({ communityId: parentId, resourceId, path, filename });
      if (!res.ok) return res;
      return {
        ok: true,
        media: {
          id: res.file.id,
          kind: communityFileKind(res.file.filename),
          filename: res.file.filename,
          sizeBytes: res.file.sizeBytes,
          label: null,
        },
      };
    },
    remove: async (parentId, mediaId) => {
      const resourceId = resourceIdRef.current;
      if (!resourceId) return { ok: false, error: "Missing entry." };
      return removeCommunityResourceFileAction(parentId, resourceId, mediaId);
    },
    checkFile: (f) => communityFileProblem(f.name, f.type, f.size),
    // A .pptx reported as empty or zip still goes up as PPTX (the bucket only
    // accepts the standard types).
    contentTypeFor: (f) => communityUploadContentType(f.name, f.type),
    onRecorded: () => onRecorded?.(),
    forbiddenMessage: "You can't add files here. Check you're still a member, then sign in again.",
  });

  /** Upload these files and attach them to this resource. */
  const start = (resourceId: string, files: File[]) => {
    resourceIdRef.current = resourceId;
    uploads.addFiles(files);
  };

  /** Cancel every upload that hasn't finished. Attached files stay. */
  const cancelUnfinished = async () => {
    for (const item of uploads.items) {
      if (item.status !== "done") await uploads.remove(item.key);
    }
  };

  const attached = uploads.items.filter((j) => j.status === "done").length;
  const unfinished = uploads.items.length - attached;

  return { ...uploads, start, cancelUnfinished, attached, unfinished };
}
