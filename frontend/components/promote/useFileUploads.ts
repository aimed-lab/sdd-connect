"use client";

// Direct, resumable file uploads for a Promote item, shared by the editor's
// Media section (MediaUploader.tsx) and the "Share a file" screen
// (QuickShare.tsx).
//
// HOW A FILE GETS IN: the browser uploads it straight to Supabase Storage
// with the resumable (TUS) protocol, as the signed-in user, into the item's
// own folder of the private showcase-media bucket. The bytes never pass
// through a Server Action. A dropped connection is retried automatically,
// and a paused upload resumes from where it stopped (also after the page is
// reopened and the same file picked again). When the upload completes,
// recordShowcaseMediaAction checks the object in Storage and writes the row.
//
// The item row itself is created lazily: `ensureShowcaseId` runs only when
// the first file is picked, and only once (single-flight), so opening a page
// never creates a draft on its own.
//
// One list of items covers both states: a file still uploading (status
// uploading / paused / saving / failed) and an attached file (status done,
// with `media`). A row keeps its key when it finishes, so a label typed while
// the file was still uploading stays put and is saved once the file is in.

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import {
  recordShowcaseMediaAction,
  removeShowcaseMediaAction,
  updateShowcaseMediaLabelAction,
} from "@/app/promote/actions";
import { getClientAccessToken, getResumableUploadTarget } from "@/lib/authClient";
import {
  buildMediaObjectPath,
  cleanMediaLabel,
  displayFileName,
  fileTooLargeMessage,
  isMediaObjectPathFor,
  uploadContentType,
} from "@/lib/server/promote/mediaFiles";
import type { ShowcaseMedia } from "@/lib/showcaseTypes";

const BUCKET = "showcase-media";
// Supabase's resumable endpoint requires exactly 6 MB chunks.
const CHUNK_BYTES = 6 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10000, 20000];

export type UploadStatus = "uploading" | "paused" | "saving" | "failed" | "done";
export type LabelState = "idle" | "saving" | "saved" | "error";

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  sent: number;
  status: UploadStatus;
  message: string | null;
  /** Set once the file is attached (status "done"). */
  media: ShowcaseMedia | null;
  label: string;
  labelState: LabelState;
  labelError: string | null;
};

type Running = {
  upload: tus.Upload;
  file: File;
  showcaseId: string;
  path: string;
  /** True once Storage has the whole file; a retry then only re-records. */
  uploaded: boolean;
  /** Stopped on a dropped connection; the "online" event restarts it. */
  paused: boolean;
};

/** HTTP status of a failed TUS request, or null for a network failure. */
function failedStatus(err: Error): number | null {
  const res = (err as tus.DetailedError).originalResponse;
  const status = res?.getStatus?.();
  return typeof status === "number" && status > 0 ? status : null;
}

/** A plain message for an upload the server refused (not a dropped line). */
function refusedMessage(status: number, err: Error): string {
  const body = ((err as tus.DetailedError).originalResponse?.getBody?.() ?? "").toLowerCase();
  if (status === 413 || body.includes("maximum allowed size") || body.includes("too large")) {
    return "Storage refused this file because it is too large.";
  }
  if (status === 415 || body.includes("mime type")) {
    return "Storage doesn't accept this file type yet.";
  }
  if (status === 401 || status === 403) {
    return "You can't upload to this item. Try signing in again.";
  }
  return "The upload was refused. Please try again.";
}

/** 4xx means the server said no; retrying won't help. 409/423/429 are
 *  conflicts or rate limits that a retry can clear. */
function isPermanent(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && ![409, 423, 429].includes(status);
}

function itemFromMedia(m: ShowcaseMedia): UploadItem {
  return {
    key: m.id,
    name: m.filename,
    size: m.sizeBytes,
    sent: m.sizeBytes,
    status: "done",
    message: null,
    media: m,
    label: m.label ?? "",
    labelState: "idle",
    labelError: null,
  };
}

export function useFileUploads({
  ensureShowcaseId,
  initialMedia,
}: {
  ensureShowcaseId: () => Promise<string>;
  initialMedia: ShowcaseMedia[];
}) {
  const showcaseIdRef = useRef<string | null>(null);
  const showcaseIdPromise = useRef<Promise<string> | null>(null);
  const running = useRef(new Map<string, Running>());
  // Latest labels by key, read when a file finishes (state may be stale in
  // the upload callbacks).
  const labelsRef = useRef(new Map<string, string>());
  const savedLabels = useRef(new Map<string, string>(initialMedia.map((m) => [m.id, m.label ?? ""])));
  const [items, setItems] = useState<UploadItem[]>(() => initialMedia.map(itemFromMedia));
  const [error, setError] = useState<string | null>(null);

  const resolveShowcaseId = (): Promise<string> => {
    if (showcaseIdRef.current) return Promise.resolve(showcaseIdRef.current);
    if (!showcaseIdPromise.current) {
      showcaseIdPromise.current = ensureShowcaseId().then(
        (id) => {
          showcaseIdRef.current = id;
          return id;
        },
        (e) => {
          showcaseIdPromise.current = null; // let the next pick try again
          throw e;
        }
      );
    }
    return showcaseIdPromise.current;
  };

  // If there's already attached media, a row obviously already exists —
  // resolve it up front so Remove and labels work on one of THESE before the
  // user has uploaded anything new this session. Harmless to call eagerly
  // here specifically because it only ever runs when initialMedia is
  // non-empty, and every caller only passes a non-empty initialMedia for an
  // entry that already exists — so this can never be what creates a draft
  // on page load.
  useEffect(() => {
    if (initialMedia.length > 0) {
      resolveShowcaseId().catch(() => {
        // A failed resolve here just means Remove won't work until a
        // successful upload resolves it instead.
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back online: carry on with every upload that paused on a dropped line.
  // Leaving the page: stop sending, but keep what was sent so picking the
  // same file again resumes it.
  useEffect(() => {
    const map = running.current;
    const onOnline = () => {
      const restarted: string[] = [];
      for (const [key, r] of map) {
        if (!r.paused) continue;
        r.paused = false;
        r.upload.start();
        restarted.push(key);
      }
      if (restarted.length > 0) {
        setItems((all) =>
          all.map((j) => (restarted.includes(j.key) ? { ...j, status: "uploading", message: null } : j))
        );
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      for (const r of map.values()) {
        if (!r.uploaded) r.upload.abort(false).catch(() => {});
      }
    };
  }, []);

  const patch = (key: string, p: Partial<UploadItem>) =>
    setItems((all) => all.map((j) => (j.key === key ? { ...j, ...p } : j)));

  const drop = (key: string) => {
    running.current.delete(key);
    labelsRef.current.delete(key);
    savedLabels.current.delete(key);
    setItems((all) => all.filter((j) => j.key !== key));
  };

  const saveLabelNow = async (key: string, mediaId: string, value: string) => {
    const showcaseId = showcaseIdRef.current;
    if (!showcaseId) return;
    patch(key, { labelState: "saving", labelError: null });
    try {
      const res = await updateShowcaseMediaLabelAction(showcaseId, mediaId, value);
      if (!res.ok) {
        patch(key, { labelState: "error", labelError: res.error });
        return;
      }
      const stored = res.label ?? "";
      savedLabels.current.set(key, stored);
      setItems((all) =>
        all.map((j) => {
          if (j.key !== key) return j;
          // Keep what the person is typing if they changed it meanwhile.
          const typed = labelsRef.current.get(key) ?? stored;
          const unchanged = cleanMediaLabel(typed) === cleanMediaLabel(value);
          return {
            ...j,
            label: unchanged ? stored : typed,
            labelState: "saved",
            labelError: null,
            media: j.media ? { ...j.media, label: res.label } : j.media,
          };
        })
      );
    } catch {
      patch(key, { labelState: "error", labelError: "Couldn't save the label. Please try again." });
    }
  };

  const recordUpload = async (key: string) => {
    const r = running.current.get(key);
    if (!r) return;
    patch(key, { status: "saving", message: null });
    try {
      const res = await recordShowcaseMediaAction({
        showcaseId: r.showcaseId,
        path: r.path,
        filename: r.file.name,
      });
      if (!res.ok) {
        patch(key, { status: "failed", message: res.error });
        return;
      }
      running.current.delete(key);
      savedLabels.current.set(key, "");
      patch(key, { status: "done", message: null, media: res.media, sent: res.media.sizeBytes, size: res.media.sizeBytes });
      const typed = labelsRef.current.get(key) ?? "";
      if (cleanMediaLabel(typed)) void saveLabelNow(key, res.media.id, typed);
    } catch {
      patch(key, { status: "failed", message: "Couldn't save the file. Please try again." });
    }
  };

  const startUpload = async (file: File) => {
    const tooLarge = fileTooLargeMessage(file.name, file.size);
    if (tooLarge) {
      setError(tooLarge);
      return;
    }
    if (file.size === 0) {
      setError(`"${displayFileName(file.name)}" is empty.`);
      return;
    }
    const target = getResumableUploadTarget();
    if (!target) {
      setError("Uploads aren't set up on this site.");
      return;
    }

    let showcaseId: string;
    try {
      showcaseId = await resolveShowcaseId();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that file. Please try again.");
      return;
    }

    const key = crypto.randomUUID();
    const contentType = uploadContentType(file.type);
    let path = buildMediaObjectPath(showcaseId, crypto.randomUUID(), file.name);

    const upload = new tus.Upload(file, {
      endpoint: target.endpoint,
      retryDelays: RETRY_DELAYS_MS,
      chunkSize: CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: target.apiKey, "x-upsert": "false" },
      metadata: { bucketName: BUCKET, objectName: path, contentType, cacheControl: "3600" },
      // Same file + same item = same upload, so it can be resumed later.
      fingerprint: async (f: File) =>
        ["promote-media", showcaseId, f.name, f.type, f.size, f.lastModified].join(":"),
      // A fresh token on every request: a long upload can outlive one.
      onBeforeRequest: async (req) => {
        const token = await getClientAccessToken();
        if (token) req.setHeader("authorization", `Bearer ${token}`);
      },
      onShouldRetry: (err) => !isPermanent(failedStatus(err)),
      onProgress: (sent) => patch(key, { sent }),
      onError: (err) => {
        const status = failedStatus(err);
        if (isPermanent(status)) {
          patch(key, { status: "failed", message: refusedMessage(status as number, err) });
        } else {
          const r = running.current.get(key);
          if (r) r.paused = true;
          patch(key, {
            status: "paused",
            message: "Connection lost. It will carry on when you're back online, or press Resume.",
          });
        }
      },
      onSuccess: () => {
        const r = running.current.get(key);
        if (r) r.uploaded = true;
        void recordUpload(key);
      },
    });

    // Picked this exact file for this item before and it didn't finish?
    // Continue that upload (same storage path) instead of starting over.
    try {
      const previous = await upload.findPreviousUploads();
      const resumable = previous.find((p) => isMediaObjectPathFor(p.metadata?.objectName ?? "", showcaseId));
      if (resumable) {
        path = resumable.metadata.objectName;
        upload.options.metadata = { ...upload.options.metadata, objectName: path };
        upload.resumeFromPreviousUpload(resumable);
      }
    } catch {
      // No stored state (private window, blocked storage): start fresh.
    }

    running.current.set(key, { upload, file, showcaseId, path, uploaded: false, paused: false });
    setItems((all) => [
      ...all,
      {
        key,
        name: displayFileName(file.name),
        size: file.size,
        sent: 0,
        status: "uploading",
        message: null,
        media: null,
        label: "",
        labelState: "idle",
        labelError: null,
      },
    ]);
    upload.start();
  };

  /** Start uploading every file, in order. */
  const addFiles = (files: File[]) => {
    setError(null);
    for (const file of files) void startUpload(file);
  };

  const resume = (key: string) => {
    const r = running.current.get(key);
    if (!r) return;
    if (r.uploaded) {
      void recordUpload(key);
      return;
    }
    r.paused = false;
    patch(key, { status: "uploading", message: null });
    r.upload.start();
  };

  /** Stop an upload in progress, or take an attached file off the item. */
  const remove = async (key: string) => {
    const item = items.find((j) => j.key === key);
    if (!item) return;
    if (item.status !== "done" || !item.media) {
      const r = running.current.get(key);
      // Terminate on the server too and forget the resume point. A file that
      // already reached Storage but couldn't be recorded has no row and is
      // never listed.
      if (r && !r.uploaded) r.upload.abort(true).catch(() => {});
      drop(key);
      return;
    }
    const showcaseId = showcaseIdRef.current;
    if (!showcaseId) return;
    setError(null);
    const res = await removeShowcaseMediaAction(showcaseId, item.media.id);
    if (res.ok) drop(key);
    else setError(res.error);
  };

  const setLabel = (key: string, value: string) => {
    labelsRef.current.set(key, value);
    setItems((all) =>
      all.map((j) =>
        j.key === key ? { ...j, label: value, labelState: j.labelState === "saving" ? "saving" : "idle" } : j
      )
    );
  };

  /** Save the label if it changed. Before the file is attached it is kept
   *  and saved automatically once the file is in. */
  const commitLabel = (key: string) => {
    const item = items.find((j) => j.key === key);
    if (!item || item.status !== "done" || !item.media) return;
    const value = labelsRef.current.get(key) ?? item.label;
    if (cleanMediaLabel(value) === cleanMediaLabel(savedLabels.current.get(key) ?? "")) return;
    void saveLabelNow(key, item.media.id, value);
  };

  const active = items.filter((j) => j.status === "uploading" || j.status === "saving");
  const inFlight = items.filter((j) => j.status !== "done" && j.status !== "failed");
  const progress = {
    sent: inFlight.reduce((n, j) => n + Math.min(j.sent, j.size), 0),
    total: inFlight.reduce((n, j) => n + j.size, 0),
  };

  return {
    items,
    error,
    setError,
    addFiles,
    resume,
    remove,
    setLabel,
    commitLabel,
    /** Anything still sending or being saved. */
    busy: active.length > 0,
    /** Anything not yet attached and not given up on (includes paused). */
    pending: inFlight.length > 0,
    progress,
    doneCount: items.filter((j) => j.status === "done").length,
    showcaseId: () => showcaseIdRef.current,
  };
}
