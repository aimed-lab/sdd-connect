// lib/server/nav/sideMenu.ts — what the side menu (components/SideMenu.tsx)
// shows and when it is open. Pure: no runtime imports, so `npm test` covers it
// and the client component can import it.

export type MenuItem = {
  label: string;
  href: string;
  /** A Material Symbols name. */
  icon: string;
  /** One line under the label (Discover items). */
  description?: string;
  /** Icon colour on a tinted square (My work items). Without it the icon is plain grey. */
  tint?: { fg: string; bg: string };
};

export type MenuGroup = { title: string; items: MenuItem[] };

/** The signed-in person's own things: the links the old account dropdown had. */
export const MY_WORK: MenuItem[] = [
  { label: "My projects", href: "/projects", icon: "folder", tint: { fg: "#1A5632", bg: "#e4efe7" } },
  { label: "My teams", href: "/teams", icon: "group", tint: { fg: "#1d4f91", bg: "#e3ecf8" } },
  { label: "My wiki pages", href: "/pages", icon: "article", tint: { fg: "#5b3a8c", bg: "#ece6f5" } },
  { label: "My shared files", href: "/files", icon: "upload_file", tint: { fg: "#0f5c63", bg: "#dff0f1" } },
  { label: "Saved items", href: "/saved", icon: "bookmark", tint: { fg: "#8a4a00", bg: "#f8ecd6" } },
];

export const DISCOVER: MenuItem[] = [
  { label: "Explore", href: "/explore", icon: "travel_explore", description: "Papers, trials and datasets" },
  { label: "Collaborate", href: "/collaborate", icon: "handshake", description: "Service providers and resources" },
  { label: "Promote", href: "/promote", icon: "campaign", description: "Share a paper or a result" },
  { label: "Communities", href: "/communities", icon: "groups", description: "Researchers in your area" },
  { label: "ColaboFest 2026", href: "/programs/colabofest-2026", icon: "emoji_events", description: "Timeline and finalists" },
];

/** The groups in order. "My work" is for signed-in people only. */
export function menuGroups(signedIn: boolean): MenuGroup[] {
  const discover = { title: "Discover", items: DISCOVER };
  return signedIn ? [{ title: "My work", items: MY_WORK }, discover] : [discover];
}

/** The pinned bottom of the menu: who is signed in (a link to Settings, the
 *  same page the header's profile button opens) and Sign out, or Sign in. */
export type MenuFooter =
  | { kind: "signed_in"; initials: string; name: string; href: "/settings"; hint: "Profile and settings"; action: "Sign out" }
  | { kind: "signed_out"; label: "Sign in"; href: "/login" };

export function menuFooter(signedIn: boolean, name: string | null | undefined): MenuFooter {
  if (!signedIn) return { kind: "signed_out", label: "Sign in", href: "/login" };
  return { kind: "signed_in", initials: initialsOf(name), name: (name ?? "").trim(), href: "/settings", hint: "Profile and settings", action: "Sign out" };
}

/** True on the item's own page and on any page under it. */
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(href + "/");
}

/** First letter of the first and of the last word ("Ada Lovelace" -> "AL"). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Everything that opens or closes the menu. */
export type MenuEvent = "menu_button" | "close_button" | "overlay" | "escape" | "link" | "navigate";

/** Only the header's menu button opens it; every other event closes it. */
export function nextOpen(_open: boolean, event: MenuEvent): boolean {
  return event === "menu_button";
}

/** Keeps Tab inside the panel. Given how many focusable things the panel has
 *  and which one has focus (-1: none of them), returns the one to focus
 *  instead, or null when the browser's own Tab already stays inside. */
export function wrapFocus(count: number, index: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (index < 0) return backwards ? count - 1 : 0;
  if (!backwards && index === count - 1) return 0;
  if (backwards && index === 0) return count - 1;
  return null;
}
