// Run with `npm test`. The side menu: what it lists, for whom, and when it is open.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DISCOVER, MY_WORK, initialsOf, isActivePath, menuFooter, menuGroups, nextOpen, wrapFocus, type MenuEvent } from "./sideMenu.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("the menu opens from the menu button and closes every other way", () => {
  assert.equal(nextOpen(false, "menu_button"), true);
  const closers: MenuEvent[] = ["close_button", "overlay", "escape", "link", "navigate"];
  for (const event of closers) {
    assert.equal(nextOpen(true, event), false, event);
    assert.equal(nextOpen(false, event), false, `${event} while closed`);
  }
});

test("the header button, close button, overlay, Escape and links are wired to those events", () => {
  const nav = read("components/Nav.tsx");
  assert.match(nav, /onMenuEvent\("menu_button"\)/);
  assert.match(nav, /aria-label="Open menu"/);
  assert.match(nav, /onMenuEvent\("navigate"\)/);
  const menu = read("components/SideMenu.tsx");
  assert.match(menu, /aria-label="Close menu"/);
  for (const event of ["close_button", "overlay", "escape", "link"]) assert.ok(menu.includes(`onEvent("${event}")`), event);
  assert.match(menu, /e\.key === "Escape"/);
});

test("signed out: no My work group, and Sign in at the bottom", () => {
  const groups = menuGroups(false);
  assert.deepEqual(groups.map((g) => g.title), ["Discover"]);
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  for (const mine of MY_WORK) assert.ok(!hrefs.includes(mine.href), mine.label);
  assert.deepEqual(menuFooter(false, null), { kind: "signed_out", label: "Sign in", href: "/login" });
});

test("signed in: My work then Discover, and Sign out at the bottom", () => {
  assert.deepEqual(menuGroups(true).map((g) => g.title), ["My work", "Discover"]);
  assert.deepEqual(menuFooter(true, " Ada Lovelace "), {
    kind: "signed_in",
    initials: "AL",
    name: "Ada Lovelace",
    href: "/settings",
    hint: "Profile and settings",
    action: "Sign out",
  });
  // The initials and name are one link to Settings that closes the menu.
  assert.match(read("components/SideMenu.tsx"), /<Link\s+href=\{footer\.href\}\s+onClick=\{pick\}/);
  // Sign out in the menu runs the same signOut the old dropdown ran.
  assert.match(read("components/Nav.tsx"), /onSignOut=\{signOut\}/);
  assert.match(read("components/SideMenu.tsx"), /onSignOut\(\);/);
});

test("everything the old account dropdown offered is still reachable", () => {
  // Dropdown: My teams, My projects, My pages, Saved items, Settings, Sign out.
  const byHref = new Map(menuGroups(true).flatMap((g) => g.items).map((i) => [i.href, i.label]));
  assert.equal(byHref.get("/teams"), "My teams");
  assert.equal(byHref.get("/projects"), "My projects");
  assert.equal(byHref.get("/pages"), "My wiki pages");
  assert.equal(byHref.get("/saved"), "Saved items");
  assert.equal(menuFooter(true, "x").kind, "signed_in"); // Sign out
  // Settings: the name at the bottom of the menu, and the round profile button in the header.
  const footer = menuFooter(true, "x");
  assert.equal(footer.kind === "signed_in" && footer.href, "/settings");
  assert.match(read("components/Nav.tsx"), /href="\/settings"\s+aria-label="My profile"/);
});

test("My work and Discover: the items, in order", () => {
  assert.deepEqual(MY_WORK.map((i) => [i.label, i.href]), [
    ["My projects", "/projects"],
    ["My teams", "/teams"],
    ["My wiki pages", "/pages"],
    ["My shared files", "/files"],
    ["Saved items", "/saved"],
  ]);
  assert.deepEqual(DISCOVER.map((i) => [i.label, i.href, i.description]), [
    ["Explore", "/explore", "Papers, trials and datasets"],
    ["Collaborate", "/collaborate", "Service providers and resources"],
    ["Promote", "/promote", "Share a paper or a result"],
    ["Communities", "/communities", "Researchers in your area"],
    ["CollaboFest 2026", "/programs/colabofest-2026", "Timeline and finalists"],
  ]);
  assert.ok(MY_WORK.every((i) => i.tint) && DISCOVER.every((i) => !i.tint));
});

test("isActivePath: the item's page and pages under it, nothing that only starts the same", () => {
  assert.equal(isActivePath("/projects", "/projects"), true);
  assert.equal(isActivePath("/projects/abc", "/projects"), true);
  assert.equal(isActivePath("/pagesx", "/pages"), false);
  assert.equal(isActivePath("/", "/explore"), false);
  assert.equal(isActivePath(null, "/explore"), false);
});

test("initialsOf: first and last word, one letter for one word, ? for nothing", () => {
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("ada maria king lovelace"), "AL");
  assert.equal(initialsOf("ada"), "A");
  assert.equal(initialsOf("ada.lovelace"), "AL");
  for (const none of [null, undefined, "", "   "]) assert.equal(initialsOf(none), "?");
});

test("wrapFocus: Tab wraps at the ends and is left alone in the middle", () => {
  assert.equal(wrapFocus(5, 4, false), 0);
  assert.equal(wrapFocus(5, 0, true), 4);
  assert.equal(wrapFocus(5, 2, false), null);
  assert.equal(wrapFocus(5, 2, true), null);
  assert.equal(wrapFocus(5, -1, false), 0);
  assert.equal(wrapFocus(5, -1, true), 4);
  assert.equal(wrapFocus(0, -1, false), null);
});

test("the old account dropdown and the old phone menu are gone from the header", () => {
  const nav = read("components/Nav.tsx");
  for (const gone of ['aria-label="Menu"', "mobileOpen", "menuOpen", "expand_more", "account_circle"]) assert.ok(!nav.includes(gone), gone);
});
