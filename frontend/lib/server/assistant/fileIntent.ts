// lib/server/assistant/fileIntent.ts — "add this file to <community, team or project>"
// in the Explore assistant, when a file is attached to the message. Pure: no I/O, no
// next/* imports, so `npm test` runs it and the browser panel imports it.
//
// THE FLOW (components/explore/AssistantChat.tsx, FileActionCards.tsx):
//   1. A file attached to a TYPED message makes it a file request. That message never
//      goes to research search, never becomes an Explore URL and never goes to the
//      backend assistant turn (the user message carries FILE_TURN_MARK; the history
//      filter and /api/assistant both refuse it).
//   2. parseFilePlaceIntent reads clear phrasings ("add this to the Savannah 2026
//      community", "share this with C-103", "add this"). When it misses, the extraction
//      route asks the model for the place's name and type. The model sees only the
//      typed text, never the file; acceptExtractedPlace keeps a name only if it is in
//      the message.
//   3. The place is found on the server among the person's own places where they may
//      add a file today (actionTargets.ts, canAddFileTo). Nothing uploads until Confirm.

import { checkCommunityFileType, communityFileProblem } from "../communityFileRules.ts";
import { PROJECT_FILE_ACCEPT, projectFileProblem } from "../projectFileRules.ts";
import { displayFileName, formatFileSize } from "../promote/mediaFiles.ts";
import type { PlaceType, TargetCandidate } from "./actionTargets.ts";
import { FILE_TURN_MARK, isFileTurn } from "./actionIntent.ts";

export { FILE_TURN_MARK, isFileTurn };

export type FilePlaceIntent = {
  kind: "add_file";
  /** The place as typed, or null when the message named none ("add this"). */
  targetName: string | null;
  targetType: PlaceType | null;
};

const MAX_MESSAGE = 500;
const MAX_TARGET = 120;

const LEAD =
  "(?:(?:please|hey|hi|ok|okay)[,\\s]+)*" +
  "(?:(?:can|could|would|will)\\s+(?:you|u)\\s+(?:please\\s+|pls\\s+)?)?" +
  "(?:(?:please|pls|just)\\s+)?" +
  "(?:(?:i|we)\\s*(?:want|need|would\\s+like|'d\\s+like|’d\\s+like)\\s+to\\s+)?";

const VERB = "(?:add|put|share|upload|post|attach|save|send|drop)";
const PREP = "(?:to|into|in|with|on|onto)";
const TYPE = "(community|team|project)";

// <verb> [object] <prep> [the|my|our] [type] <name> [type] [please]
const PLACE_RE = new RegExp(
  "^" +
    LEAD +
    VERB +
    "(?:\\s+(?!(?:to|into|in|with|on|onto)\\b)(.{1,60}?))?" +
    "\\s+" +
    PREP +
    "\\s+(?:the\\s+|my\\s+|our\\s+)?" +
    "(?:" +
    TYPE +
    "\\s+)?" +
    "(.+?)" +
    "(?:\\s+" +
    TYPE +
    ")?" +
    "(?:[,\\s]+please)?" +
    "\\s*[.!?]*$",
  "i"
);

// "add this", "upload it please", "share the file"
const NO_PLACE_RE = new RegExp(
  "^" +
    LEAD +
    VERB +
    "(?:\\s+(?:this|it|that|these|them|the\\s+file|this\\s+file|the\\s+attachment))?" +
    "(?:\\s+(?:here|please|for\\s+me))?" +
    "\\s*[.!?]*$",
  "i"
);

function cleanTarget(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TARGET);
}

function placeType(raw: string | undefined | null): PlaceType | null {
  const t = (raw ?? "").toLowerCase();
  return t === "community" || t === "team" || t === "project" ? t : null;
}

function words(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The strict parser. A message with nothing typed, or "add this", names no place.
 *  Null when the wording isn't one of the clear ones (then the model is asked). */
export function parseFilePlaceIntent(text: string): FilePlaceIntent | null {
  const t = (text ?? "").trim();
  if (!t) return { kind: "add_file", targetName: null, targetType: null };
  if (t.length > MAX_MESSAGE) return null;
  if (NO_PLACE_RE.test(t)) return { kind: "add_file", targetName: null, targetType: null };
  const m = PLACE_RE.exec(t);
  if (!m) return null;
  const name = cleanTarget(m[3]);
  if (!name || /^(it|this|that|here|there|me|us|them)$/i.test(name)) return null;
  if (/\s(or|and)\s/i.test(` ${name} `)) return null;
  return { kind: "add_file", targetName: name, targetType: placeType(m[2]) ?? placeType(m[4]) };
}

/** The model's answer for a file message, checked against the typed text. A name the
 *  message doesn't contain is dropped (the person then picks from their places). */
export function acceptExtractedPlace(raw: unknown, message: string): FilePlaceIntent {
  const none: FilePlaceIntent = { kind: "add_file", targetName: null, targetType: null };
  if (!raw || typeof raw !== "object") return none;
  const r = raw as Record<string, unknown>;
  const name = typeof r.target_name === "string" ? cleanTarget(r.target_name) : "";
  if (!name) return none;
  const n = words(name);
  if (!n || !` ${words(message)} `.includes(` ${n} `)) return none;
  return { kind: "add_file", targetName: name, targetType: placeType(typeof r.target_type === "string" ? r.target_type : null) };
}

// ── the file itself ──────────────────────────────────────────────────────────

/** The attach button's `accept`: everything any place takes (project files take the
 *  most types; a community or team takes fewer, checked on the card). */
export const ATTACH_ACCEPT = PROJECT_FILE_ACCEPT;

/** Refused at attach time: not a type any place takes, empty, or over 50 MB. */
export function attachProblem(name: string, type: string, size: number): string | null {
  return projectFileProblem(name, type, size);
}

/** Why this file can't go to this kind of place, or null. The same rules the
 *  server checks: communityFileRules for a community or team, projectFileRules for a
 *  project. */
export function fileProblemFor(place: PlaceType, name: string, type: string, size: number): string | null {
  return place === "project" ? projectFileProblem(name, type, size) : communityFileProblem(name, type, size);
}

/** True when a community or team would refuse this file's type (for a plainer note). */
export function wrongTypeForCommunity(name: string, type: string): boolean {
  return !checkCommunityFileType(name, type).ok;
}

/** The chip under the message box: "Deck.pptx · 31.0 MB". */
export function attachmentLabel(name: string, size: number): string {
  return `${displayFileName(name)} · ${formatFileSize(size)}`;
}

/** The default title: the file name without its extension. */
export function defaultTitle(name: string): string {
  const n = displayFileName(name);
  const i = n.lastIndexOf(".");
  return (i > 0 ? n.slice(0, i) : n).slice(0, 200);
}

// ── keeping file turns out of research ───────────────────────────────────────

/** A file request's user message: what was typed, then FILE_TURN_MARK and the name.
 *  The mark keeps the turn out of research (actionIntent.ts, messagesForResearch). */
export function fileTurnContent(typed: string, fileName: string): string {
  const text = typed.trim() || "Add this file";
  return `${text}\n\n${FILE_TURN_MARK}${displayFileName(fileName)}`;
}


// ── what the card and the chat say ───────────────────────────────────────────

export function placeNoun(t: PlaceType): string {
  return t === "community" ? "Community" : t === "team" ? "Team" : "Project";
}

/** Who can open a file added here. From the real rules:
 *  - community: community_resources / community_resource_files and their storage
 *    objects are readable by members only (is_community_member); the one exception is
 *    a resource an admin PINS on a community whose public preview is "open"
 *    (2026-10-22_community_pinned_resource.sql), which anyone can open. A new file is
 *    never pinned.
 *  - team: members only (the same policies); teams are open, so anyone with the link
 *    can join.
 *  - project: members only (2026-11-19_project_files.sql). */
export function accessLine(c: Pick<TargetCandidate, "type">): string {
  if (c.type === "community") {
    return "Only members of this community can open it, unless an admin pins it to the community's public preview.";
  }
  if (c.type === "team") return "Only members of this team can open it. Anyone with the team's link can join.";
  return "Only members of this project can open it.";
}

export type FileResultNote =
  | { kind: "qr"; line: string }
  | { kind: "text"; line: string };

/** What the result shows under "Added …": the join QR and Copy link where the place
 *  has a join link, else a plain line. */
export function resultNote(c: Pick<TargetCandidate, "type" | "inviteOnly" | "isOpen">): FileResultNote {
  if (c.type === "project") return { kind: "text", line: "Only project members can see it." };
  if (c.type === "community" && c.inviteOnly) {
    return { kind: "text", line: "This community is invite only, so there is no join link. Only its members can see the file." };
  }
  if (c.type === "community" && !c.isOpen) {
    return { kind: "qr", line: "People who scan this and sign in can ask to join. Once an admin approves them, they can see the file." };
  }
  return { kind: "qr", line: "People who scan this and sign in can join and see the file." };
}

export type FileOutcome =
  | { kind: "candidates"; count: number; named: boolean }
  | { kind: "none"; name: string; siteAdmin: boolean; type: PlaceType | null }
  | { kind: "error"; message: string };

/** The line above the card once the lookup is done. */
export function fileReplyFor(o: FileOutcome): string {
  if (o.kind === "error") return o.message;
  if (o.kind === "none") {
    if (o.siteAdmin && (o.type === null || o.type === "community")) {
      return `No community called ${o.name}. Create it and add this file?`;
    }
    return `You don't have a ${o.type ?? "community, team or project"} called ${o.name} that you can add files to. Create a team called ${o.name} and add this file?`;
  }
  if (o.count === 0) return "You don't have a community, team or project you can add files to yet.";
  if (!o.named) return "Where should this file go? Pick a place, then press Confirm. Nothing uploads until you do.";
  if (o.count > 1) return "More than one of your places matches. Pick one, then press Confirm. Nothing uploads until you do.";
  return "Here's what I'd do. Check it, then press Confirm. Nothing uploads until you do.";
}

export function lookingLine(intent: FilePlaceIntent): string {
  return intent.targetName ? `Looking for ${intent.targetName} in your places…` : "Looking up your communities, teams and projects…";
}
