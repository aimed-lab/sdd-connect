// lib/server/assistant/actionIntent.ts — "add <email> to <team or project>" requests
// to the Explore assistant. Read in the browser BEFORE any backend call, the same way
// teamIntent.ts reads "create a team".
//
// TWO STEPS:
//   1. parseAddMemberIntent: a strict parser for clear phrasings, anchored to the whole
//      message ("add xyz@gmail.com to ABCD team", "invite xyz@gmail.com to ABCD").
//   2. When the parser misses, ANY typed message with an email address goes to the model,
//      which extracts {email, target_name, target_type} or nothing
//      (app/api/assistant/extract-action). The model only extracts; acceptExtractedIntent
//      then refuses anything that does not come from the message itself.
//
// A MESSAGE WITH AN EMAIL ADDRESS NEVER GOES TO RESEARCH: not to the search sources, not
// into an Explore URL, not to the backend assistant turn (routeForMessage; the
// /api/assistant route refuses it too, and messagesForResearch keeps such messages out
// of the history it sends). If it isn't an add request the panel answers with
// EMAIL_HELP_REPLY.
//
// THE RULE IN BOTH: the email must appear exactly (ignoring case) in what the person
// typed, and so must the target's name. Nothing here picks an id or runs anything: the
// target is found on the server among the person's own teams and projects
// (actionTargets.ts), and nothing changes until they press Confirm on the card.
//
// ONLY THE PERSON'S OWN TYPED MESSAGE comes here: never a starter, a related question,
// a choice button or anything a page or search result produced
// (components/explore/AssistantChat.tsx, `typed`).
//
// No imports, so `npm test` runs it directly.

export type TargetType = "team" | "project";

export type AddMemberIntent = {
  kind: "add_member";
  email: string;
  /** The team or project name as typed (a CollaboFest code like "C-103" counts). */
  targetName: string;
  /** Said in the message ("ABCD team", "the C-103 project"), else null. */
  targetType: TargetType | null;
};

const EMAIL_SRC = "[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const EMAIL_RE = new RegExp(`^${EMAIL_SRC}$`);
const EMAIL_ANYWHERE = new RegExp(EMAIL_SRC, "g");

/** The panel's input box allows 500 characters. */
const MAX_MESSAGE = 500;
const MAX_TARGET = 120;

// Polite openings, as in teamIntent.ts.
const LEAD =
  "(?:(?:please|hey|hi|ok|okay)[,\\s]+)*" +
  "(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?)?" +
  "(?:(?:please|just)\\s+)?" +
  "(?:(?:i|we)\\s*(?:want|need|would\\s+like|'d\\s+like|’d\\s+like)\\s+to\\s+)?";

const VERB = "(?:add|invite|put|include)";
const PREP = "(?:to|into|in|onto|on)";

// <verb> <email> [as a member] <prep> [the|my|our] [team|project] <name> [team|project] [as a member] [please]
const ADD_RE = new RegExp(
  "^" +
    LEAD +
    VERB +
    "\\s+(" +
    EMAIL_SRC +
    ")" +
    "(?:\\s+as\\s+an?\\s+member)?" +
    "\\s+" +
    PREP +
    "\\s+(?:the\\s+|my\\s+|our\\s+)?" +
    "(?:(team|project)\\s+)?" +
    "(.+?)" +
    "(?:\\s+(team|project))?" +
    "(?:\\s+as\\s+an?\\s+member)?" +
    "(?:[,\\s]+please)?" +
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

function typeOf(raw: string | undefined): TargetType | null {
  const t = (raw ?? "").toLowerCase();
  return t === "team" || t === "project" ? t : null;
}

/** Every email address in a message. */
export function emailsIn(text: string): string[] {
  return (text ?? "").match(EMAIL_ANYWHERE) ?? [];
}

/** True when `email` is a well-formed address that appears in `message` exactly
 *  (ignoring case). */
export function emailIsInMessage(email: string, message: string): boolean {
  const e = (email ?? "").trim();
  if (!EMAIL_RE.test(e)) return false;
  return emailsIn(message).some((m) => m.toLowerCase() === e.toLowerCase());
}

function normal(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** True when the target name (as words) appears in the message. */
export function targetIsInMessage(targetName: string, message: string): boolean {
  const t = normal(targetName);
  return !!t && ` ${normal(message)} `.includes(` ${t} `);
}

/** The strict parser: an add-member request in one of the clear phrasings, or null. */
export function parseAddMemberIntent(text: string): AddMemberIntent | null {
  const t = (text ?? "").trim();
  if (t.length < 8 || t.length > MAX_MESSAGE) return null;
  const m = ADD_RE.exec(t);
  if (!m) return null;
  const email = m[1];
  const targetName = cleanTarget(m[3]);
  // "to ABCD team or the other one", "to my team": not a clear target.
  if (!targetName || /\s(or|and)\s/i.test(` ${targetName} `) || emailsIn(targetName).length > 0) return null;
  if (/^(team|project|it|them|this|that)$/i.test(targetName)) return null;
  if (!emailIsInMessage(email, t)) return null;
  return { kind: "add_member", email, targetName, targetType: typeOf(m[2]) ?? typeOf(m[4]) };
}

/** Does this message contain an email address? Then it is never a research question:
 *  a typed one goes to the extraction step, anything else gets EMAIL_HELP_REPLY. */
export function hasEmailAddress(text: string): boolean {
  return emailsIn(text ?? "").length > 0;
}

/** Where the panel sends a message:
 *    "extract"  typed, with an email: strict parser, then the model; a card or the help reply
 *    "help"     an email but not typed by the person (a chip, another page): the help reply
 *    "research" no email: the normal assistant turn */
export function routeForMessage(text: string, typed: boolean): "extract" | "help" | "research" {
  if (!hasEmailAddress(text)) return "research";
  return typed && (text ?? "").trim().length <= MAX_MESSAGE ? "extract" : "help";
}

/** The history sent to the research backend: without any user message that contains
 *  an email address, and without the assistant reply that followed it. */
export function messagesForResearch<M extends { role: string; content: string }>(messages: M[]): M[] {
  const out: M[] = [];
  let skipReply = false;
  for (const m of messages) {
    if (m.role === "user") {
      skipReply = hasEmailAddress(m.content);
      if (!skipReply) out.push(m);
    } else if (skipReply) {
      skipReply = false;
    } else {
      out.push(m);
    }
  }
  return out;
}

/** What the panel says to a message with an email address that is not an add request
 *  (or could not be read as one). */
export const EMAIL_CAN_DO =
  'With an email I can add someone to a team or project you lead, for example: "add name@example.org to the ABCD team".';

export const EMAIL_HELP_REPLY = `I don't search with email addresses. ${EMAIL_CAN_DO} Nothing changes until you press Confirm.`;

/** The model's extraction, checked against the message it came from. Null unless the
 *  email and the target name both appear in what the person typed. */
export function acceptExtractedIntent(raw: unknown, message: string): AddMemberIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const email = typeof r.email === "string" ? r.email.trim() : "";
  const targetName = typeof r.target_name === "string" ? cleanTarget(r.target_name) : "";
  if (!email || !targetName) return null;
  if (!emailIsInMessage(email, message)) return null;
  if (!targetIsInMessage(targetName, message)) return null;
  const targetType = typeOf(typeof r.target_type === "string" ? r.target_type : undefined);
  return { kind: "add_member", email, targetName, targetType };
}

/** What the assistant says above the card when there is something to confirm. */
export const ADD_MEMBER_REPLY = "Here's what I'd do. Check it, then press Confirm. Nothing changes until you do.";

/** Shown above the card while the team or project is looked up. */
export function addMemberLookingReply(intent: AddMemberIntent): string {
  return `Looking for ${intent.targetName} in your teams and projects…`;
}

export type AddMemberOutcome =
  | { kind: "candidates"; count: number }
  | { kind: "none"; message: string }
  | { kind: "error"; message: string };

/** The line above the card once the lookup is done. The confirm line only when there
 *  is a Confirm button: one match, or several to pick from. */
export function addMemberReplyFor(outcome: AddMemberOutcome): string {
  if (outcome.kind === "candidates" && outcome.count > 0) {
    return outcome.count === 1
      ? ADD_MEMBER_REPLY
      : "More than one of yours matches. Pick one, then press Confirm. Nothing changes until you do.";
  }
  // No Confirm button: say why, and what an email can be used for.
  if (outcome.kind === "candidates") return `I couldn't find that team or project. ${EMAIL_CAN_DO}`;
  if (outcome.kind === "none") return `${outcome.message} ${EMAIL_CAN_DO}`;
  return outcome.message;
}

/** The line on every card. */
export const ADD_MEMBER_NOTE =
  "Adds as a member. No email is sent. Ask them to sign in at connect.smartdrugdiscovery.org with this email.";
