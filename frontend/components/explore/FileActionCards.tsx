"use client";

// The Explore assistant's card for "add this file to <community, team or project>"
// (lib/server/assistant/fileIntent.ts). The file stays in the browser until Confirm.
//
// 1. Look up the place among the person's own places where they may add a file today
//    (resolveFilePlaceAction, read with their session). No place named: every place,
//    nothing chosen. Several: a picker, nothing chosen. None: offer to create it (a site
//    admin: a community, through the existing community draft card; anyone else: a team,
//    through the existing team draft card), always with "Pick another place". Creating
//    never uploads: it comes back here to the confirm step.
// 2. Confirm step: the file, an editable title, the place, and who will be able to open it.
// 3. On Confirm the file uploads straight to Storage (useResumableUploads), with
//    progress and Cancel, and is recorded through the existing actions: a community
//    resource plus its file (community or team), or recordProjectFileAction (project).
//    A cancelled or failed upload leaves no empty entry behind.
// 4. Result: "Added <title> to <place>", the join QR and Copy link where the place has
//    a join link, or a plain line where it doesn't.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { resolveFilePlaceAction } from "@/app/explore/assistantActions";
import { createCommunityAction, createCommunityResourceAction, deleteCommunityResourceAction } from "@/app/communities/actions";
import { recordProjectFileAction, removeProjectFileAction, type ProjectUploadMedia } from "@/app/projects/[id]/actions";
import UploadRow from "@/components/promote/UploadRow";
import JoinQr from "@/components/communities/JoinQr";
import CopyLinkButton from "@/components/communities/CopyLinkButton";
import { useCommunityFileUploads } from "@/components/communities/useCommunityFileUploads";
import { useResumableUploads } from "@/components/uploads/useResumableUploads";
import CommunityDraft, { type DraftStage } from "./CommunityDraft";
import { TeamDraftCard } from "./TeamAssistantCards";
import { getResumableUploadTarget } from "@/lib/authClient";
import type { CreateCommunityAction } from "@/lib/server/assistant/assistantReply";
import type { PlaceType, TargetCandidate } from "@/lib/server/assistant/actionTargets";
import {
  acceptExtractedPlace,
  accessLine,
  defaultTitle,
  fileProblemFor,
  placeNoun,
  resultNote,
  type FileOutcome,
  type FilePlaceIntent,
} from "@/lib/server/assistant/fileIntent";
import {
  PROJECT_FILES_BUCKET,
  buildProjectFilePath,
  checkProjectFileType,
  isProjectFilePathFor,
  projectFileProblem,
} from "@/lib/server/projectFileRules";
import { formatFileSize } from "@/lib/server/promote/mediaFiles";

/** For a file message the strict parser missed: ask the extraction route (mode "file")
 *  for the place. It sends only the typed text, never the file. Checked again here;
 *  on any failure, no place is named and the person picks one. */
export async function extractFilePlace(message: string): Promise<FilePlaceIntent> {
  const none: FilePlaceIntent = { kind: "add_file", targetName: null, targetType: null };
  try {
    const res = await fetch("/api/assistant/extract-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode: "file" }),
    });
    if (!res.ok) return none;
    const data = (await res.json()) as { intent?: FilePlaceIntent | null };
    const i = data?.intent;
    if (!i) return none;
    return acceptExtractedPlace({ target_name: i.targetName, target_type: i.targetType }, message);
  } catch {
    return none;
  }
}

const CARD = "rounded-xl border border-outline-variant/40 bg-white p-4 flex flex-col gap-3";
const EYEBROW = "font-label-sm text-[11px] tracking-[0.12em] uppercase text-secondary";
const LINK = "font-label-md text-label-md text-primary hover:underline underline-offset-4";

type PickState = { candidates: TargetCandidate[]; all: TargetCandidate[]; named: boolean; siteAdmin: boolean };

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | ({ kind: "pick"; note: string | null } & PickState)
  | { kind: "nomatch"; name: string; type: PlaceType | null; siteAdmin: boolean; all: TargetCandidate[] }
  | { kind: "createCommunity"; all: TargetCandidate[]; draft: CreateCommunityAction; stage: DraftStage }
  | { kind: "createTeam"; name: string; all: TargetCandidate[] }
  | { kind: "uploading"; place: TargetCandidate; title: string; back: PickState }
  | { kind: "done"; place: TargetCandidate; title: string }
  | { kind: "cancelled" };

const keyOf = (c: TargetCandidate) => `${c.type}:${c.id}`;

function placeMeta(c: TargetCandidate): string {
  const noun = c.code && !c.name.includes(c.code) ? `${placeNoun(c.type)} · ${c.code}` : placeNoun(c.type);
  return `${noun} · ${c.memberCount} ${c.memberCount === 1 ? "member" : "members"}`;
}

export function AddFileCard({
  file,
  intent,
  signedIn,
  authLoading,
  onOutcome,
}: {
  file: File;
  intent: FilePlaceIntent;
  signedIn: boolean;
  authLoading: boolean;
  /** So the line above the card says the right thing (the confirm line only when there
   *  is something to confirm). */
  onOutcome?: (o: FileOutcome | { kind: "line"; text: string }) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle(file.name));
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const showPick = (p: PickState, preselect: TargetCandidate | null, note: string | null = null) => {
    setChosen(preselect ? keyOf(preselect) : null);
    setPhase({ kind: "pick", note, ...p });
  };

  // 1. Look up the place.
  useEffect(() => {
    void resolveFilePlaceAction({ targetName: intent.targetName, targetType: intent.targetType }).then((res) => {
      if (!live.current) return;
      if (!res.ok) {
        onOutcome?.({ kind: "error", message: res.error });
        return setPhase({ kind: "error", message: res.error });
      }
      if (res.named && res.candidates.length === 0) {
        const name = intent.targetName ?? "";
        onOutcome?.({ kind: "none", name, siteAdmin: res.siteAdmin, type: intent.targetType });
        return setPhase({ kind: "nomatch", name, type: intent.targetType, siteAdmin: res.siteAdmin, all: res.all });
      }
      onOutcome?.({ kind: "candidates", count: res.candidates.length, named: res.named });
      // One named match is shown as the choice; otherwise nothing is chosen.
      showPick(res, res.named && res.candidates.length === 1 ? res.candidates[0] : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.targetName, intent.targetType]);

  /** After a new community or team: find it among the person's places, then confirm. */
  const continueWith = async (slug: string, fallbackAll: TargetCandidate[]) => {
    const res = await resolveFilePlaceAction({ targetName: null, targetType: null, slug });
    if (!live.current) return;
    if (!res.ok || res.candidates.length === 0) {
      showPick({ candidates: res.ok ? res.all : fallbackAll, all: res.ok ? res.all : fallbackAll, named: false, siteAdmin: false }, null, "Created. Pick it below to add the file.");
      return;
    }
    onOutcome?.({ kind: "line", text: "Created. Check it, then press Confirm. Nothing uploads until you do." });
    showPick({ candidates: res.candidates, all: res.all, named: true, siteAdmin: res.siteAdmin }, res.candidates[0]);
  };

  const pickAnother = (all: TargetCandidate[]) => {
    onOutcome?.({ kind: "candidates", count: all.length, named: false });
    showPick({ candidates: all, all, named: false, siteAdmin: false }, null);
  };

  if (phase.kind === "loading") return null; // the line above says it is looking

  if (phase.kind === "error") {
    return (
      <div className={CARD}>
        <div className="flex flex-wrap gap-4">
          <Link href="/teams" className={LINK}>My teams</Link>
          <Link href="/projects" className={LINK}>My projects</Link>
        </div>
      </div>
    );
  }

  if (phase.kind === "cancelled") {
    return (
      <div className={CARD} role="status">
        <p className="font-body-sm text-body-sm text-secondary">Cancelled. Nothing was uploaded.</p>
      </div>
    );
  }

  if (phase.kind === "nomatch") {
    const offerCommunity = phase.siteAdmin && (phase.type === null || phase.type === "community");
    return (
      <div className={CARD}>
        <span className={EYEBROW}>Add a file</span>
        <p className="font-body-sm text-body-sm text-secondary">{file.name} · {formatFileSize(file.size)}</p>
        <div className="flex flex-wrap items-center gap-3">
          {offerCommunity ? (
            <button
              type="button"
              onClick={() =>
                setPhase({
                  kind: "createCommunity",
                  all: phase.all,
                  draft: { type: "create_community", name: phase.name, purpose: `Files and updates for ${phase.name}.` },
                  stage: "edit",
                })
              }
              className="btn-primary px-4 py-2 rounded-lg font-label-md text-label-md"
            >
              Create community {phase.name}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPhase({ kind: "createTeam", name: phase.name, all: phase.all })}
              className="btn-primary px-4 py-2 rounded-lg font-label-md text-label-md"
            >
              Create team {phase.name}
            </button>
          )}
          <button type="button" onClick={() => pickAnother(phase.all)} className={LINK}>
            Pick another place
          </button>
          <button type="button" onClick={() => setPhase({ kind: "cancelled" })} className="font-label-md text-label-md text-secondary hover:text-on-background">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "createCommunity") {
    const p = phase;
    return (
      <div className="flex flex-col gap-2">
        <CommunityDraft
          draft={p.draft}
          kind="community"
          canChoose={false}
          onKind={() => {}}
          stage={p.stage}
          signedIn={signedIn}
          authLoading={authLoading}
          onChange={(d) => setPhase({ ...p, draft: d })}
          onStage={(s) => setPhase({ ...p, stage: s })}
          onCreate={async () => {
            setPhase({ ...p, stage: "creating" });
            const res = await createCommunityAction({ name: p.draft.name, purpose: p.draft.purpose, kind: "community" });
            if (!live.current) return;
            if (!res.ok) return setPhase({ ...p, stage: { error: res.error } });
            // Created; nothing uploaded. Back to the confirm step for the new community.
            void continueWith(res.slug, p.all);
          }}
        />
        <button type="button" onClick={() => pickAnother(p.all)} className={`self-start ${LINK}`}>
          Pick another place
        </button>
      </div>
    );
  }

  if (phase.kind === "createTeam") {
    const p = phase;
    return (
      <div className="flex flex-col gap-2">
        <TeamDraftCard
          initialName={p.name}
          signedIn={signedIn}
          authLoading={authLoading}
          onCreated={(slug) => void continueWith(slug, p.all)}
        />
        <button type="button" onClick={() => pickAnother(p.all)} className={`self-start ${LINK}`}>
          Pick another place
        </button>
      </div>
    );
  }

  if (phase.kind === "uploading") {
    const p = phase;
    const back = (message: string) => {
      if (!live.current) return;
      showPick(p.back, p.place, message);
    };
    const Step = p.place.type === "project" ? ProjectUploadStep : CommunityUploadStep;
    return (
      <div className={CARD}>
        <span className={EYEBROW}>Uploading to {p.place.name}</span>
        <Step
          place={p.place}
          title={p.title}
          file={file}
          onDone={() => {
            if (!live.current) return;
            // The line above no longer asks for a Confirm.
            onOutcome?.({ kind: "line", text: "Done." });
            setPhase({ kind: "done", place: p.place, title: p.title });
          }}
          onFail={back}
        />
      </div>
    );
  }

  if (phase.kind === "done") {
    const { place } = phase;
    const note = resultNote(place);
    return (
      <div className="rounded-xl border border-primary bg-white p-4 flex flex-col gap-3" role="status">
        <p className="font-body-md text-body-md text-on-background">
          Added <span className="font-semibold">{phase.title}</span> to{" "}
          <Link href={place.href} className="text-primary hover:underline underline-offset-4">
            {place.name}
          </Link>
          .
        </p>
        {note.kind === "qr" && place.slug ? (
          <div className="flex flex-col gap-2">
            <JoinQr slug={place.slug} name={place.name} isAdmin={false} team={place.type === "team"} />
            <CopyLinkButton slug={place.slug} team={place.type === "team"} label="Copy link" />
            <p className="font-body-sm text-body-sm text-secondary">{note.line}</p>
          </div>
        ) : (
          <p className="font-body-sm text-body-sm text-secondary">{note.line}</p>
        )}
      </div>
    );
  }

  // The confirm step.
  const p = phase;
  const several = p.candidates.length > 1 || !p.named;
  const target = p.candidates.find((c) => keyOf(c) === chosen) ?? null;
  const problem = target ? fileProblemFor(target.type, file.name, file.type, file.size) : null;
  const noTarget = !getResumableUploadTarget();

  if (p.candidates.length === 0) {
    return (
      <div className={CARD}>
        <div className="flex flex-wrap gap-4">
          <Link href="/teams/new" className={LINK}>Create a team</Link>
          <Link href="/projects" className={LINK}>My projects</Link>
        </div>
      </div>
    );
  }

  const confirm = () => {
    if (!target || problem || noTarget) return;
    const t = title.trim() || defaultTitle(file.name);
    setPhase({ kind: "uploading", place: target, title: t, back: { candidates: p.candidates, all: p.all, named: p.named, siteAdmin: p.siteAdmin } });
  };

  return (
    <div className={CARD}>
      <span className={EYEBROW}>Add a file</span>
      <div className="flex flex-col gap-1">
        <span className="font-body-md text-body-md text-on-background font-semibold break-all">{file.name}</span>
        <span className="font-body-sm text-body-sm text-secondary">{formatFileSize(file.size)}</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-label-sm text-label-sm text-secondary">Title</span>
        <input
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-3 py-2 font-body-md text-body-md text-on-background focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-label-sm text-label-sm text-secondary mb-1">
          {several ? "Add to (pick one)" : "Add to"}
        </legend>
        {p.candidates.map((c) => {
          const k = keyOf(c);
          const wrong = fileProblemFor(c.type, file.name, file.type, file.size);
          const body = (
            <span className="min-w-0 flex flex-col">
              <span className="font-body-md text-body-md text-on-background font-semibold break-words">{c.name}</span>
              <span className="font-body-sm text-body-sm text-secondary">
                {placeMeta(c)} ·{" "}
                <Link href={c.href} target="_blank" className="text-primary hover:underline underline-offset-4">
                  Open
                </Link>
              </span>
              {wrong && <span className="font-body-sm text-body-sm text-error">{wrong}</span>}
            </span>
          );
          return several ? (
            <label
              key={k}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer ${chosen === k ? "border-primary" : "border-outline-variant/40"}`}
            >
              <input
                type="radio"
                name={`file-place-${file.name}-${file.size}`}
                checked={chosen === k}
                onChange={() => setChosen(k)}
                className="mt-1 accent-[#1A5632]"
              />
              {body}
            </label>
          ) : (
            <div key={k} className="rounded-lg border border-outline-variant/40 px-3 py-2">
              {body}
            </div>
          );
        })}
      </fieldset>

      {target && <p className="font-body-sm text-body-sm text-on-background">{accessLine(target)}</p>}
      {p.note && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          {p.note}
        </p>
      )}
      {noTarget && (
        <p className="font-body-sm text-body-sm text-error" role="alert">
          Uploads aren&rsquo;t set up on this site.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={!target || !!problem || noTarget}
          className="btn-primary px-5 py-2 rounded-lg font-label-md text-label-md disabled:opacity-50"
        >
          Confirm
        </button>
        <button type="button" onClick={() => setPhase({ kind: "cancelled" })} className="font-label-md text-label-md text-secondary hover:text-on-background">
          Cancel
        </button>
        {p.named && p.all.length > p.candidates.length && (
          <button type="button" onClick={() => pickAnother(p.all)} className={LINK}>
            Pick another place
          </button>
        )}
      </div>
    </div>
  );
}

type StepProps = {
  place: TargetCandidate;
  title: string;
  file: File;
  onDone: () => void;
  /** Failed or cancelled; nothing is left behind. */
  onFail: (message: string) => void;
};

/** A community or team: the resource first, then the file into it. If nothing gets
 *  attached the resource is deleted again. */
function CommunityUploadStep({ place, title, file, onDone, onFail }: StepProps) {
  const uploads = useCommunityFileUploads(place.id);
  const started = useRef(false);
  const created = useRef<string | null>(null);
  const seen = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const made = await createCommunityResourceAction(place.id, place.slug ?? "", {
        title,
        resource_type: "other",
        url: "",
        description: "",
      });
      if (!made.ok) {
        settled.current = true;
        return onFail(made.error);
      }
      created.current = made.id;
      uploads.start(made.id, [file]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settled.current || !created.current) return;
    if (uploads.items.length > 0) seen.current = true;
    const refused = !seen.current && !!uploads.error;
    if (!refused && (!seen.current || uploads.unfinished > 0)) return;
    settled.current = true;
    if (uploads.attached > 0) return onDone();
    const id = created.current;
    void deleteCommunityResourceAction(place.id, id, place.slug ?? "").then((r) => {
      if (!r.ok) console.error("AddFileCard: couldn't remove the empty entry", r.error);
    });
    onFail(uploads.error ?? "The upload was cancelled, so nothing was added.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads.items.length, uploads.unfinished, uploads.attached, uploads.error]);

  return <UploadList uploads={uploads} />;
}

/** A project: upload, then recordProjectFileAction (which deletes the object itself if
 *  it fails a check). A cancelled upload leaves nothing. */
function ProjectUploadStep({ place, title, file, onDone, onFail }: StepProps) {
  const uploads = useResumableUploads<ProjectUploadMedia>({
    bucket: PROJECT_FILES_BUCKET,
    resumeKey: "project-files",
    ensureParentId: async () => place.id,
    initialMedia: [],
    buildPath: buildProjectFilePath,
    isPathFor: isProjectFilePathFor,
    record: ({ parentId, path, filename }) => recordProjectFileAction({ projectId: parentId, path, filename, title }),
    remove: removeProjectFileAction,
    checkFile: (f) => projectFileProblem(f.name, f.type, f.size),
    contentTypeFor: (f) => {
      const t = checkProjectFileType(f.name, f.type);
      return t.ok ? t.contentType : "application/octet-stream";
    },
    forbiddenMessage: "You can't share files in this project. Check you're still a member, then sign in again.",
  });
  const started = useRef(false);
  const seen = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    uploads.addFiles([file]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settled.current) return;
    if (uploads.items.length > 0) seen.current = true;
    const refused = !seen.current && !!uploads.error;
    const attached = uploads.items.filter((j) => j.status === "done").length;
    const unfinished = uploads.items.length - attached;
    if (!refused && (!seen.current || unfinished > 0)) return;
    settled.current = true;
    if (attached > 0) return onDone();
    onFail(uploads.error ?? "The upload was cancelled, so nothing was added.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads.items, uploads.error]);

  return <UploadList uploads={uploads} />;
}

function UploadList({
  uploads,
}: {
  uploads: { items: Parameters<typeof UploadRow>[0]["item"][]; remove: (key: string) => Promise<void>; resume: (key: string) => void };
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Upload">
      {uploads.items.map((item) => (
        <UploadRow key={item.key} item={item} onRemove={() => void uploads.remove(item.key)} onResume={() => uploads.resume(item.key)} />
      ))}
    </ul>
  );
}
