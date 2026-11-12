// lib/server/teams/teamRules.ts — the rules for TEAMS, as plain functions.
//
// A team is a `communities` row with kind = 'team' (database/migrations/
// 2026-10-28_teams.sql). The database is the real gate for every rule here
// (policies, triggers, CHECKs); these functions say the same thing in code so
// the UI can show or hide the right controls, and so `npm test` can pin the
// rules down. No imports, so node can run the tests directly.

export type CommunityKind = "community" | "team";

/** The community email join accepts only a row of kind 'community'. A team id
 *  sent there is refused (here, and in join_open_community_by_email). */
export function canEmailJoinAsCommunity(kind: CommunityKind | string | null | undefined): boolean {
  return kind === "community";
}

export function isKind(v: unknown): v is CommunityKind {
  return v === "community" || v === "team";
}

// ── who can create what ─────────────────────────────────────────────────────

/** Signed in people make teams; only site admins make communities. */
export function canCreateKind(kind: CommunityKind, v: { signedIn: boolean; siteAdmin: boolean }): boolean {
  if (!v.signedIn) return false;
  return kind === "team" ? true : v.siteAdmin;
}

/** What the assistant does when asked to create a community. A non-admin gets a
 *  team straight away; an admin is asked which one they want. */
export function assistantCreateChoice(v: { siteAdmin: boolean }): "make_team" | "ask" {
  return v.siteAdmin ? "ask" : "make_team";
}

// ── what a team is, whatever the caller asked for ───────────────────────────

/** Mirrors the trigger + CHECK on communities: a team is always open to join
 *  and always shows outsiders nothing but its name and description. */
export function normalizeSettings<T extends { kind: CommunityKind; is_open: boolean; public_preview: string }>(
  row: T
): T {
  return row.kind === "team" ? { ...row, is_open: true, public_preview: "minimal" } : row;
}

/** Kind never changes after creation. */
export function canChangeKind(from: CommunityKind, to: CommunityKind): boolean {
  return from === to;
}

// ── resources (documents, links, files) ─────────────────────────────────────

type ResourceWho = { kind: CommunityKind; isMember: boolean; isAdmin: boolean };

/** Teams: any active member adds. Communities: admins only. */
export function canAddResource(w: ResourceWho): boolean {
  return w.kind === "team" ? w.isMember : w.isAdmin;
}

/** Teams: the uploader or an admin removes or edits. Communities: admins. */
export function canChangeResource(w: ResourceWho & { isUploader: boolean }): boolean {
  return w.isAdmin || (w.kind === "team" && w.isMember && w.isUploader);
}

// ── wiki pages curated into a team ──────────────────────────────────────────

export type PageForRead = {
  visibility: "private" | "team" | "public";
  ownerId: string | null;
  /** The viewer is in this page's own page_members list. */
  inPageMembers: boolean;
  /** The viewer belongs to the page's project (project pages). */
  inProject: boolean;
  /** Ids of teams this page is curated into. */
  curatedInTeams: string[];
};

export const TEAM_VISIBLE_NOTE = "This page will be visible to your team.";

/** Mirrors can_read_page() after 2026-10-28: the old rules, plus "curated into
 *  a team the viewer is an active member of". */
export function canReadPage(page: PageForRead, viewer: { userId: string | null; teamIds: string[] }): boolean {
  if (page.visibility === "public") return true;
  if (!viewer.userId) return false;
  if (page.ownerId === viewer.userId) return true;
  if (page.visibility === "team" && page.inPageMembers) return true;
  if (page.inProject) return true;
  // Curating shares a page only while it is not private: setting it back to
  // Private takes the team's access away.
  if (page.visibility === "private") return false;
  return page.curatedInTeams.some((t) => viewer.teamIds.includes(t));
}

/** Any member may add a page they can already read, if it is their own (at any
 *  visibility) or somebody else's PUBLIC page. Another person's team or private
 *  page is never re-shared. Mirrors can_curate_page(). */
export function canCuratePage(v: {
  isMember: boolean;
  canRead: boolean;
  visibility: "private" | "team" | "public";
  isOwner: boolean;
}): boolean {
  return v.isMember && v.canRead && (v.isOwner || v.visibility === "public");
}

/** Adding your own PRIVATE page switches it to 'team'. Other cases change nothing. */
export function visibilityAfterCurate(
  visibility: "private" | "team" | "public",
  isOwner: boolean
): "private" | "team" | "public" {
  return visibility === "private" && isOwner ? "team" : visibility;
}

/** The person who added it, or a team admin, takes it off the team. */
export function canRemoveCurated(v: { isAdder: boolean; isTeamAdmin: boolean }): boolean {
  return v.isAdder || v.isTeamAdmin;
}

/** Shown before someone adds their OWN private page: it becomes visible to the team. */
export function curateNote(page: { visibility: string; ownerId: string | null }, userId: string): string | null {
  return page.visibility === "private" && page.ownerId === userId ? TEAM_VISIBLE_NOTE : null;
}

/** A public page that shows a team's NAME links to the team only when the
 *  viewer was given its slug (community_labels returns it for members only). */
export function teamLabelHref(label: { slug: string | null; kind: string }): string | null {
  if (!label.slug) return null;
  return label.kind === "team" ? `/teams/${label.slug}` : `/communities/${label.slug}`;
}

export type CuratedHow = "curated" | "made";

export function pageLabel(how: string): "Made by AI" | "Curated" {
  return how === "made" ? "Made by AI" : "Curated";
}

/** Case-insensitive title filter for the page picker; blank returns everything. */
export function filterPagesByTitle<T extends { title: string }>(pages: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter((p) => p.title.toLowerCase().includes(q));
}

// ── linking a team to a community ───────────────────────────────────────────

export type LinkCheck =
  | { ok: true }
  | { ok: false; reason: "wrong_kind" | "not_team_admin" | "not_in_community" };

/** Both ids must be the right kind; the team's admin links, and must be in the
 *  community already. */
export function canLinkTeam(v: {
  teamKind: CommunityKind;
  communityKind: CommunityKind;
  isTeamAdmin: boolean;
  isCommunityMember: boolean;
}): LinkCheck {
  if (v.teamKind !== "team" || v.communityKind !== "community") return { ok: false, reason: "wrong_kind" };
  if (!v.isTeamAdmin) return { ok: false, reason: "not_team_admin" };
  if (!v.isCommunityMember) return { ok: false, reason: "not_in_community" };
  return { ok: true };
}

/** The team's admin or the community's admin may unlink. */
export function canUnlinkTeam(v: { isTeamAdmin: boolean; isCommunityAdmin: boolean }): boolean {
  return v.isTeamAdmin || v.isCommunityAdmin;
}

export const LINK_MESSAGE: Record<Exclude<LinkCheck, { ok: true }>["reason"], string> = {
  wrong_kind: "A team can only be linked to a community.",
  not_team_admin: "Only a team lead can link the team to a community.",
  not_in_community: "Join that community first, then link your team.",
};

// ── create a team ───────────────────────────────────────────────────────────

export const TEAM_NAME_MAX = 80;
export const MAX_INVITES = 50;

export function parseTeamName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, error: "Give your team a name." };
  if (name.length > TEAM_NAME_MAX) return { ok: false, error: `Keep the team name under ${TEAM_NAME_MAX} letters.` };
  return { ok: true, name };
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Emails separated by commas, semicolons, spaces or new lines. Lowercased,
 *  duplicates dropped; anything that is not an email is returned in `invalid`. */
export function parseEmails(raw: unknown): { valid: string[]; invalid: string[]; tooMany: boolean } {
  const parts = (typeof raw === "string" ? raw : "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (p.length <= 254 && EMAIL_RE.test(p)) {
      if (!valid.includes(p)) valid.push(p);
    } else if (!invalid.includes(p)) {
      invalid.push(p);
    }
  }
  return { valid: valid.slice(0, MAX_INVITES), invalid, tooMany: valid.length > MAX_INVITES };
}

/** Where a signed-out visitor goes to sign in and come back with the typed name kept. */
export function createTeamCallback(name: string): string {
  const n = name.trim().slice(0, TEAM_NAME_MAX);
  return n ? `/teams/new?name=${encodeURIComponent(n)}` : "/teams/new";
}

// ── joining ─────────────────────────────────────────────────────────────────

export type JoinView = "member" | "pending" | "join_button" | "email_or_sign_in";

/** What a team page's header offers this visitor. Teams are always open, so
 *  there is no "request to join". */
export function joinView(state: "signed_out" | "none" | "pending" | "active"): JoinView {
  if (state === "active") return "member";
  if (state === "pending") return "pending";
  if (state === "none") return "join_button";
  return "email_or_sign_in";
}

/** The sentence under the email form after a signed-out join. They have no
 *  account yet, so they can't open the team until they sign in with that email. */
export const EMAIL_JOINED_NOTE =
  "You are on the team. Sign in with this email to open it and see what the team has shared.";

// ── links and labels ────────────────────────────────────────────────────────

export function teamPath(slug: string): string {
  return `/teams/${slug}`;
}

export function teamJoinUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/teams/${slug}?join=1`;
}

/** The page a row of this kind lives on. */
export function pathForKind(kind: CommunityKind, slug: string): string {
  return kind === "team" ? `/teams/${slug}` : `/communities/${slug}`;
}

export function roleLabel(role: string | null | undefined): "Lead" | "Member" {
  return role === "admin" || role === "lead" ? "Lead" : "Member";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function teamHeaderLine(memberCount: number): string {
  return `Team · private · ${plural(memberCount, "member")}`;
}

// ── the assistant ───────────────────────────────────────────────────────────

/** The text the "Make learning material" tile puts in the assistant. */
export function makePagePrompt(teamName: string): string {
  return `Make a wiki page for my team ${teamName.replace(/\s+/g, " ").trim().slice(0, 80)} about: `;
}

/** Max length of "What will you work on?" on the create form. It becomes the
 *  team's one-line description, so it has the description's limit
 *  (TEAM_DESCRIPTION_MAX in teams.ts). */
export const TEAM_FOCUS_MAX = 160;

/** The create form's "What will you work on?": optional, one line, at most
 *  TEAM_FOCUS_MAX. Empty is fine (no description, no assistant). */
export function parseTeamFocus(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text.length > TEAM_FOCUS_MAX) return { ok: false, error: `Keep it under ${TEAM_FOCUS_MAX} letters.` };
  return { ok: true, text };
}

/** The request the assistant is sent once, right after a team is created with
 *  "What will you work on?" filled: the same "make a wiki page for my team"
 *  request as the tile, with that topic after "about:". "" when there is no
 *  topic (then nothing is sent). */
export function creationLearnPrompt(teamName: string, focus: string | null | undefined): string {
  const topic = (focus ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return topic ? `${makePagePrompt(teamName)}${topic}` : "";
}

/** The topic in a team page request: only the part after "about:", never the
 *  team name. "" when the message has no "about:" or nothing after it. */
export function teamTopicFromMessage(text: string): string {
  const m = /\babout\s*:\s*([\s\S]*)$/i.exec(text ?? "");
  return m ? m[1].replace(/[\s?!.]+$/, "").trim().slice(0, 200) : "";
}

/** The slug in a /teams/<slug> path, or null (also null for /teams and /teams/new). */
export function teamSlugFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/teams\/([a-z0-9-]{1,200})\/?$/.exec(pathname ?? "");
  return m && m[1] !== "new" ? m[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A team id from untrusted input, or null. */
export function parseTeamId(raw: unknown): string | null {
  return typeof raw === "string" && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** The sentence the assistant says after it made a team for someone. */
export function teamCreatedReply(name: string): string {
  return `I created a team for you: ${name}. You are its lead. Open it to add people and share material.`;
}

// ── progress updates ────────────────────────────────────────────────────────
// A progress update is a community_announcements row with progress_tag set
// (database/migrations/2026-11-11_team_progress_handover.sql). Its text is the
// row's title. A row without a tag is ordinary Team news.

export const PROGRESS_TAGS = ["done", "working", "stuck"] as const;
export type ProgressTag = (typeof PROGRESS_TAGS)[number];

export const DEFAULT_PROGRESS_TAG: ProgressTag = "working";

export const PROGRESS_TAG_LABEL: Record<ProgressTag, string> = {
  done: "Done",
  working: "Working on",
  stuck: "Stuck",
};

export function isProgressTag(v: unknown): v is ProgressTag {
  return v === "done" || v === "working" || v === "stuck";
}

export const PROGRESS_TEXT_MAX = 280;
/** How many updates the Progress card shows before "See older updates". */
export const PROGRESS_SHOWN = 5;

/** One line of text: line breaks and runs of spaces become one space. */
export function parseProgressText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "Write a short update first." };
  if (text.length > PROGRESS_TEXT_MAX) return { ok: false, error: `Keep the update under ${PROGRESS_TEXT_MAX} letters.` };
  return { ok: true, text };
}

/** Splits a team's announcements into Team news (no tag) and Progress (tagged),
 *  keeping the order they came in (newest first). `tags` maps an announcement
 *  id to its tag; an id that is not in it, or has an unknown tag, is news. */
export function splitAnnouncements<T extends { id: string }>(
  items: T[],
  tags: Record<string, string | null | undefined>
): { news: T[]; progress: (T & { tag: ProgressTag })[] } {
  const news: T[] = [];
  const progress: (T & { tag: ProgressTag })[] = [];
  for (const item of items) {
    const tag = tags[item.id];
    if (isProgressTag(tag)) progress.push({ ...item, tag });
    else news.push(item);
  }
  return { news, progress };
}

/** The latest five, or all of them once "See older updates" was pressed. */
export function shownProgress<T>(items: T[], expanded: boolean): { shown: T[]; older: number } {
  if (expanded || items.length <= PROGRESS_SHOWN) return { shown: items, older: 0 };
  return { shown: items.slice(0, PROGRESS_SHOWN), older: items.length - PROGRESS_SHOWN };
}

/** The author or a lead deletes a progress update. */
export function canDeleteProgress(v: { isLead: boolean; authorId: string; viewerId: string }): boolean {
  return v.isLead || (!!v.viewerId && v.authorId === v.viewerId);
}

// ── handover ────────────────────────────────────────────────────────────────
// A handover row is a community_resources row with handover_slot set (same
// migration): at most one per slot per team. A link is in `url`; the note is in
// `description`. A row without a slot is an ordinary shared document.

export const HANDOVER_SLOTS = [
  { key: "box", label: "Box folder", kind: "link", resourceType: "folder" },
  { key: "github", label: "GitHub repository", kind: "link", resourceType: "link" },
  { key: "report", label: "Final report", kind: "link", resourceType: "link" },
  { key: "note", label: "Handover note", kind: "note", resourceType: "notes" },
] as const;
export type HandoverSlot = (typeof HANDOVER_SLOTS)[number]["key"];

export function isHandoverSlot(v: unknown): v is HandoverSlot {
  return HANDOVER_SLOTS.some((s) => s.key === v);
}

export const HANDOVER_NOTE_MAX = 1000;
export const HANDOVER_NOTE_HINT = "What is done, what is left, who to ask";

/** A link must be http or https. Returns it normalized. */
export function parseHandoverLink(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Paste a link first." };
  try {
    const u = new URL(text);
    if (u.protocol === "http:" || u.protocol === "https:") return { ok: true, url: u.toString() };
  } catch {
    /* not a URL */
  }
  return { ok: false, error: "Please paste a link that starts with http:// or https://." };
}

/** Plain text, at most 1000 characters. */
export function parseHandoverNote(raw: unknown): { ok: true; note: string } | { ok: false; error: string } {
  const note = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if (!note) return { ok: false, error: "Write the note first." };
  if (note.length > HANDOVER_NOTE_MAX) return { ok: false, error: `Keep the note under ${HANDOVER_NOTE_MAX} characters.` };
  return { ok: true, note };
}

/** What a slot stores: a link in `url`, or the note in `description`. */
export function parseHandoverValue(
  slot: HandoverSlot,
  raw: unknown
): { ok: true; url: string | null; description: string } | { ok: false; error: string } {
  if (slot === "note") {
    const n = parseHandoverNote(raw);
    return n.ok ? { ok: true, url: null, description: n.note } : n;
  }
  const l = parseHandoverLink(raw);
  return l.ok ? { ok: true, url: l.url, description: "" } : l;
}

export type HandoverRow<T> = { slot: HandoverSlot; label: string; kind: "link" | "note"; resource: T | null };

/** Splits a team's resources into the four Handover rows (always four, in
 *  order, empty ones included) and the ordinary Shared documents. `slots` maps
 *  a resource id to its slot. A slotted row that is not usable (a link slot
 *  with no link, a note with no text) leaves its slot empty and is not shown
 *  as a document either. */
export function splitResources<T extends { id: string; url: string | null; description: string }>(
  resources: T[],
  slots: Record<string, string | null | undefined>
): { handover: HandoverRow<T>[]; documents: T[] } {
  const bySlot = new Map<HandoverSlot, T>();
  const documents: T[] = [];
  for (const r of resources) {
    const slot = slots[r.id];
    if (!isHandoverSlot(slot)) documents.push(r);
    else if (!bySlot.has(slot)) bySlot.set(slot, r);
  }
  const handover = HANDOVER_SLOTS.map((s) => {
    const r = bySlot.get(s.key) ?? null;
    const filled = !!r && (s.kind === "note" ? !!r.description.trim() : !!r.url && /^https?:\/\//i.test(r.url));
    return { slot: s.key, label: s.label, kind: s.kind, resource: filled ? r : null };
  });
  return { handover, documents };
}

/** Whoever added a handover row, or a lead, changes or removes it. Anyone on
 *  the team fills an empty one. */
export function canChangeHandover(v: { isLead: boolean; addedBy: string | null; viewerId: string }): boolean {
  if (v.addedBy === null) return true;
  return v.isLead || (!!v.viewerId && v.addedBy === v.viewerId);
}
