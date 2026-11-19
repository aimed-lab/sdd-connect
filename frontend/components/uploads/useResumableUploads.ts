"use client";

// Direct, resumable file uploads into a private Supabase Storage bucket,
// shared by Promote / "Share a file" (components/promote/useFileUploads.ts)
// and project files (components/projects/workspace/ProjectFilesSection.tsx).
//
// HOW A FILE GETS IN: the browser uploads it straight to Supabase Storage
// with the resumable (TUS) protocol, as the signed-in user, into the parent's
// own folder of the bucket. The bytes never pass through a Server Action. A
// dropped connection is retried automatically, and a paused upload resumes
// from where it stopped (also after the page is reopened and the same file
// picked again). When the upload completes, the caller's `record` action
// checks the object in Storage and writes the row.
//
// Everything specific to one feature comes in as options: the bucket, the
// path builder and its check, the resume key, the record / remove / label
// actions, an optional file check and the content type to upload with.
//
// The parent id (a showcase, a project) is resolved lazily: `ensureParentId`
// runs only when the first file is picked, and only once (single-flight), so
// opening a page never creates anything on its own.
//
// One list of items covers both states: a file still uploading (status
// uploading / paused / saving / failed) and an attached file (status done,
// with `media`). A row keeps its key when it finishes, so a label typed while
// the file was still uploading stays put and is saved once the file is in.

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { getClientAccessToken, getResumableUploadTarget } from "@/lib/authClient";
import { cleanMediaLabel, displayFileName, fileTooLargeMessage, uploadContentType } from "@/lib/server/promote/mediaFiles";

// Supabase's resumable endpoint requires exactly 6 MB chunks.
const CHUNK_BYTES = 6 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10000, 20000];

export type UploadStatus = "uploading" | "paused" | "saving" | "failed" | "done";
export type LabelState = "idle" | "saving" | "saved" | "error";

/** The least an attached file must carry to be listed in an upload row. */
export type UploadedMedia = {
  id: string;
  kind: string;
  filename: string;
  sizeBytes: number;
  label: string | null;
};

export type UploadItem<M extends UploadedMedia = UploadedMedia> = {
  key: string;
  name: string;
  size: number;
  sent: number;
  status: UploadStatus;
  message: string | null;
  /** Set once the file is attached (status "done"). */
  media: M | null;
  label: string;
  labelState: LabelState;
  labelError: string | null;
};

type Failure = { ok: false; error: string };

export type ResumableUploadOptions<M extends UploadedMedia> = {
  /** The private bucket the files go into. */
  bucket: string;
  /** Prefix of the resume key: same file + same parent = same upload. */
  resumeKey: string;
  ensureParentId: () => Promise<string>;
  initialMedia: M[];
  buildPath: (parentId: string, fileId: string, filename: string) => string;
  /** True for a path buildPath could have made for this parent; used to pick
   *  a previous upload to resume. */
  isPathFor: (path: string, parentId: string) => boolean;
  /** Write the row for an upload that reached Storage. `label` is whatever
   *  was typed so far; a feature that saves labels separately ignores it. */
  record: (args: { parentId: string; path: string; filename: string; label: string }) => Promise<{ ok: true; media: M } | Failure>;
  remove: (parentId: string, mediaId: string) => Promise<{ ok: true } | Failure>;
  /** Save a label on an attached file. Without it, labels are only sent with
   *  `record`. */
  updateLabel?: (parentId: string, mediaId: string, label: string) => Promise<{ ok: true; label: string | null } | Failure>;
  /** A message for a file that must not be uploaded, checked first. */
  checkFile?: (file: File) => string | null;
  /** The content type sent to Storage. Default: the browser's, or the generic
   *  binary type. */
  contentTypeFor?: (file: File) => string;
  /** Called once a file is recorded (after its label, if any, is saved). */
  onRecorded?: (media: M, key: string) => void;
  /** Shown for a 401/403 from Storage. */
  forbiddenMessage?: string;
};

type Running = {
  upload: tus.Upload;
  file: File;
  parentId: string;
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
function refusedMessage(status: number, err: Error, forbidden: string): string {
  const body = ((err as tus.DetailedError).originalResponse?.getBody?.() ?? "").toLowerCase();
  if (status === 413 || body.includes("maximum allowed size") || body.includes("too large")) {
    return "Storage refused this file because it is too large.";
  }
  if (status === 415 || body.includes("mime type")) {
    return "Storage doesn't accept this file type yet.";
  }
  if (status === 401 || status === 403) {
    return forbidden;
  }
  return "The upload was refused. Please try again.";
}

/** 4xx means the server said no; retrying won't help. 409/423/429 are
 *  conflicts or rate limits that a retry can clear. */
function isPermanent(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500 && ![409, 423, 429].includes(status);
}

function itemFromMedia<M extends UploadedMedia>(m: M): UploadItem<M> {
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

export function useResumableUploads<M extends UploadedMedia>(opts: ResumableUploadOptions<M>) {
  // The latest options, read inside long-lived upload callbacks.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { ensureParentId, initialMedia } = opts;
  const parentIdRef = useRef<string | null>(null);
  const parentIdPromise = useRef<Promise<string> | null>(null);
  const running = useRef(new Map<string, Running>());
  // Latest labels by key, read when a file finishes (state may be stale in
  // the upload callbacks).
  const labelsRef = useRef(new Map<string, string>());
  const savedLabels = useRef(new Map<string, string>(initialMedia.map((m) => [m.id, m.label ?? ""])));
  const [items, setItems] = useState<UploadItem<M>[]>(() => initialMedia.map(itemFromMedia));
  const [error, setError] = useState<string | null>(null);

  const resolveParentId = (): Promise<string> => {
    if (parentIdRef.current) return Promise.resolve(parentIdRef.current);
    if (!parentIdPromise.current) {
      parentIdPromise.current = ensureParentId().then(
        (id) => {
          parentIdRef.current = id;
          return id;
        },
        (e) => {
          parentIdPromise.current = null; // let the next pick try again
          throw e;
        }
      );
    }
    return parentIdPromise.current;
  };

  // If there's already attached media, the parent obviously already exists —
  // resolve it up front so Remove and labels work on one of THESE before the
  // user has uploaded anything new this session. Only runs when initialMedia
  // is non-empty, so it can never be what creates a draft on page load.
  useEffect(() => {
    if (initialMedia.length > 0) {
      resolveParentId().catch(() => {
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

  const patch = (key: string, p: Partial<UploadItem<M>>) =>
    setItems((all) => all.map((j) => (j.key === key ? { ...j, ...p } : j)));

  const drop = (key: string) => {
    running.current.delete(key);
    labelsRef.current.delete(key);
    savedLabels.current.delete(key);
    setItems((all) => all.filter((j) => j.key !== key));
  };

  const saveLabelNow = async (key: string, mediaId: string, value: string) => {
    const parentId = parentIdRef.current;
    const updateLabel = optsRef.current.updateLabel;
    if (!parentId || !updateLabel) return;
    patch(key, { labelState: "saving", labelError: null });
    try {
      const res = await updateLabel(parentId, mediaId, value);
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
      const res = await optsRef.current.record({
        parentId: r.parentId,
        path: r.path,
        filename: r.file.name,
        label: labelsRef.current.get(key) ?? "",
      });
      if (!res.ok) {
        patch(key, { status: "failed", message: res.error });
        return;
      }
      running.current.delete(key);
      savedLabels.current.set(key, res.media.label ?? "");
      patch(key, { status: "done", message: null, media: res.media, sent: res.media.sizeBytes, size: res.media.sizeBytes });
      const typed = labelsRef.current.get(key) ?? "";
      if (optsRef.current.updateLabel && cleanMediaLabel(typed)) await saveLabelNow(key, res.media.id, typed);
      optsRef.current.onRecorded?.(res.media, key);
    } catch {
      patch(key, { status: "failed", message: "Couldn't save the file. Please try again." });
    }
  };

  const startUpload = async (file: File) => {
    const o = optsRef.current;
    const refused = o.checkFile ? o.checkFile(file) : fileTooLargeMessage(file.name, file.size);
    if (refused) {
      setError(refused);
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

    let parentId: string;
    try {
      parentId = await resolveParentId();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that file. Please try again.");
      return;
    }

    const key = crypto.randomUUID();
    const contentType = o.contentTypeFor ? o.contentTypeFor(file) : uploadContentType(file.type);
    let path = o.buildPath(parentId, crypto.randomUUID(), file.name);
    const forbidden = o.forbiddenMessage ?? "You can't upload to this item. Try signing in again.";

    const upload = new tus.Upload(file, {
      endpoint: target.endpoint,
      retryDelays: RETRY_DELAYS_MS,
      chunkSize: CHUNK_BYTES,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: target.apiKey, "x-upsert": "false" },
      metadata: { bucketName: o.bucket, objectName: path, contentType, cacheControl: "3600" },
      // Same file + same parent = same upload, so it can be resumed later.
      fingerprint: async (f: File) => [o.resumeKey, parentId, f.name, f.type, f.size, f.lastModified].join(":"),
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
          patch(key, { status: "failed", message: refusedMessage(status as number, err, forbidden) });
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

    // Picked this exact file for this parent before and it didn't finish?
    // Continue that upload (same storage path) instead of starting over.
    try {
      const previous = await upload.findPreviousUploads();
      const resumable = previous.find((p) => o.isPathFor(p.metadata?.objectName ?? "", parentId));
      if (resumable) {
        path = resumable.metadata.objectName;
        upload.options.metadata = { ...upload.options.metadata, objectName: path };
        upload.resumeFromPreviousUpload(resumable);
      }
    } catch {
      // No stored state (private window, blocked storage): start fresh.
    }

    running.current.set(key, { upload, file, parentId, path, uploaded: false, paused: false });
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

  /** Stop an upload in progress, or take an attached file off the parent. */
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
    const parentId = parentIdRef.current;
    if (!parentId) return;
    setError(null);
    const res = await optsRef.current.remove(parentId, item.media.id);
    if (res.ok) drop(key);
    else setError(res.error);
  };

  /** Take a finished row off the list without touching the file (the caller
   *  shows it elsewhere). */
  const dismiss = (key: string) => drop(key);

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
    dismiss,
    setLabel,
    commitLabel,
    /** Anything still sending or being saved. */
    busy: active.length > 0,
    /** Anything not yet attached and not given up on (includes paused). */
    pending: inFlight.length > 0,
    progress,
    doneCount: items.filter((j) => j.status === "done").length,
    parentId: () => parentIdRef.current,
  };
}
