// lib/server/assistant/assistantBridge.ts — how a button elsewhere on the page
// (Explore's "New wiki page", "Follow this topic", suggested
// follow-ups) hands a message to the assistant panel. The page dispatches a
// window event; the panel (components/explore/AssistantChat.tsx) listens, opens
// itself and either SENDS the message as the researcher's own turn or FILLS the
// input. Nothing is created here: a wiki page still goes through the panel's
// usual picker and confirm step.
//
// Pure (its only import, actionIntent.ts, is pure too), so `npm test` covers it.

import { hasEmailAddress } from "./actionIntent.ts";

export const ASSISTANT_EVENT = "sdd:assistant";

/** A team the page the assistant makes should be added to ("Make learning
 *  material" on a team page). */
export type AssistantTeam = { id: string; name: string; slug: string };

// The team whose page is open. The team page registers it so the panel knows
// the team even when the message is typed by hand (not sent from the tile).
// A window global, not only an event: the page's effect can run before the
// panel's listener exists on a first load.
declare global {
  interface Window {
    __sddPageTeam?: AssistantTeam | null;
  }
}

export function setPageTeam(team: AssistantTeam | null): void {
  if (typeof window === "undefined") return;
  window.__sddPageTeam = team;
}

export function getPageTeam(): AssistantTeam | null {
  return typeof window === "undefined" ? null : (window.__sddPageTeam ?? null);
}

/** `stay`: the page behind must not move to another Explore search because of
 *  this message ("Follow this topic" on a results page). */
export type AssistantRequest = { text: string; mode: "send" | "fill" | "open"; team?: AssistantTeam; stay?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTeam(raw: unknown): AssistantTeam | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const t = raw as Record<string, unknown>;
  const name = typeof t.name === "string" ? t.name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const slug = typeof t.slug === "string" && /^[a-z0-9-]{1,200}$/.test(t.slug) ? t.slug : "";
  if (typeof t.id !== "string" || !UUID_RE.test(t.id) || !name || !slug) return undefined;
  return { id: t.id.toLowerCase(), name, slug };
}

const MAX_TEXT = 500;

/** A request from untrusted event data, or null when it is not usable. */
export function parseAssistantRequest(raw: unknown): AssistantRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // "open" just opens the panel (no text needed.
  if (r.mode === "open") return { text: "", mode: "open" };
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;
  const team = parseTeam(r.team);
  return { text, mode: r.mode === "fill" ? "fill" : "send", ...(team ? { team } : {}), ...(r.stay === true ? { stay: true } : {}) };
}

/** Opens the assistant panel and sends (or fills) `text`. Safe to call on the server (does nothing). */
export function openAssistant(request: AssistantRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: request }));
}

const FOLLOW_SENT_PREFIX = "I'd like to create a wiki page on ";

/** The message that starts the existing save flow for a topic. This sentence is
 *  what the assistant backend receives (it recognizes a page request by these
 *  words); the panel shows it as "Follow <topic>" (shownUserText). */
export function saveAsLivingPageMessage(topic: string): string {
  return `${FOLLOW_SENT_PREFIX}${topic.trim().slice(0, 150)}`;
}

/** What the panel shows for a user message: the "Follow this topic" sentence
 *  reads "Follow <topic>"; every other message is shown as it is. */
export function shownUserText(content: string): string {
  const topic = content.startsWith(FOLLOW_SENT_PREFIX) ? content.slice(FOLLOW_SENT_PREFIX.length).trim() : "";
  return topic ? `Follow ${topic}` : content;
}

/** The message behind the dashed "New wiki page" card. */
export const START_LIVING_PAGE_MESSAGE = "I'd like to create a wiki page for my research.";

// ── text a person just typed into an Explore search box ─────────────────────
//
// Everything above is for messages OTHER parts of the page send in (chips, starters,
// "Follow this topic", links): the panel sends them as non-typed, so they are never
// read for actions (add a member, add a file). This is the ONE exception, kept
// separate on purpose:
//   * its own event name (TYPED_SEARCH_EVENT), not ASSISTANT_EVENT, so a request built
//     for the generic bridge can never be read as typed;
//   * only components/explore/QuestionBox.tsx calls handOffTypedSearch, from its form
//     submit (never from its example chips);
//   * it only carries text that contains an email address (the one reason it exists:
//     such text must not become /explore/<text>); anything else is dropped;
//   * when the panel is not on this page (the home page), the text waits in
//     sessionStorage for at most HANDOFF_TTL_MS and is read once, on /explore.

export const TYPED_SEARCH_EVENT = "sdd:assistant-typed-search";
export const TYPED_SEARCH_STORAGE_KEY = "sdd.assistant.typedSearch";
export const HANDOFF_TTL_MS = 60_000;

export type TypedSearchHandoff = { text: string };

/** A hand-off from event data, or null. Requires source "search_box" and text with an
 *  email address. */
export function parseTypedSearchHandoff(raw: unknown): TypedSearchHandoff | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.source !== "search_box") return null;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_TEXT) : "";
  if (!text || !hasEmailAddress(text)) return null;
  return { text };
}

/** A hand-off stored for the next page, or null when it is missing, malformed or older
 *  than HANDOFF_TTL_MS. */
export function parseStoredTypedSearch(stored: string | null, now: number): TypedSearchHandoff | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as { at?: unknown };
    const at = typeof v.at === "number" ? v.at : NaN;
    if (!Number.isFinite(at) || now - at < 0 || now - at > HANDOFF_TTL_MS) return null;
    return parseTypedSearchHandoff(v);
  } catch {
    return null;
  }
}

/** Should this search-box text go to the assistant instead of becoming a search? */
export function shouldHandOffSearch(text: string): boolean {
  return hasEmailAddress(text);
}

/** From a search box's submit: give the typed text to the assistant panel. With the
 *  panel on this page, an event; otherwise it waits (once, briefly) for /explore. */
export function handOffTypedSearch(text: string, panelOnThisPage: boolean): void {
  if (typeof window === "undefined" || !shouldHandOffSearch(text)) return;
  const detail = { source: "search_box", text: text.trim().slice(0, MAX_TEXT) };
  if (panelOnThisPage) {
    window.dispatchEvent(new CustomEvent(TYPED_SEARCH_EVENT, { detail }));
    return;
  }
  try {
    window.sessionStorage.setItem(TYPED_SEARCH_STORAGE_KEY, JSON.stringify({ ...detail, at: Date.now() }));
  } catch {
    // Storage blocked: the panel just opens without the text.
  }
}

/** Read and remove a waiting hand-off (the panel, on mount). */
export function takeStoredTypedSearch(): TypedSearchHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(TYPED_SEARCH_STORAGE_KEY);
    window.sessionStorage.removeItem(TYPED_SEARCH_STORAGE_KEY);
    return parseStoredTypedSearch(stored, Date.now());
  } catch {
    return null;
  }
}
