"use client";

// The side menu: a panel that slides in from the left, opened by the menu
// button in the header (components/Nav.tsx). It holds what the account dropdown
// and the phone menu used to hold. What it lists, and when it is open, is
// decided in lib/server/nav/sideMenu.ts.
//
// Rendered NEXT TO the header, not inside it: the header has a backdrop blur,
// and a fixed element inside a blurred one is sized to that element, not to
// the screen.
//
// It stays mounted while closed (hidden with `invisible`) so it can slide. A
// hidden panel cannot be focused or read by a screen reader.

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { isActivePath, menuFooter, menuGroups, wrapFocus, type MenuEvent, type MenuItem } from "@/lib/server/nav/sideMenu";

const FOCUSABLE = "a[href], button:not([disabled])";

function Item({ item, active, onPick }: { item: MenuItem; active: boolean; onPick: () => void }) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onPick}
        aria-current={active ? "page" : undefined}
        className={
          "flex items-center gap-3 min-h-11 px-2 py-1.5 rounded-xl transition-colors " +
          (active ? "bg-[#f3f1ea]" : "hover:bg-surface-container-low")
        }
      >
        <span
          aria-hidden="true"
          style={item.tint ? { color: item.tint.fg, backgroundColor: item.tint.bg } : undefined}
          className={
            "material-symbols-outlined shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[20px] " +
            (item.tint ? "" : "text-secondary")
          }
        >
          {item.icon}
        </span>
        <span className="min-w-0 flex flex-col">
          <span className="font-label-md text-label-md text-on-background">{item.label}</span>
          {item.description && <span className="font-body-sm text-body-sm text-secondary">{item.description}</span>}
        </span>
      </Link>
    </li>
  );
}

export default function SideMenu({
  open,
  pathname,
  signedIn,
  name,
  onEvent,
  onSignOut,
  menuButtonRef,
}: {
  open: boolean;
  pathname: string;
  signedIn: boolean;
  name: string | null;
  /** Must keep the same identity between renders (it is an effect dependency). */
  onEvent: (event: MenuEvent) => void;
  onSignOut: () => void;
  /** The header button that opened the menu; focus returns to it on close. */
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Focus: the close button on open, back to the menu button on close.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [open, menuButtonRef]);

  // While open: Escape closes, and the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEvent("escape");
    };
    document.addEventListener("keydown", onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = before;
    };
  }, [open, onEvent]);

  // Tab stays inside the panel.
  const keepFocusInside = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const els = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const to = wrapFocus(els.length, els.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    els[to].focus();
  };

  const footer = menuFooter(signedIn, name);
  const pick = () => onEvent("link");

  return (
    <div
      className={
        "fixed inset-0 z-[70] " +
        // Closing: stay visible until the slide has finished (not at all with reduced motion).
        (open ? "visible" : "invisible transition-[visibility] duration-0 delay-200 motion-reduce:delay-0")
      }
    >
      <div
        aria-hidden="true"
        onClick={() => onEvent("overlay")}
        className={
          "absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none " +
          (open ? "opacity-100" : "opacity-0")
        }
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onKeyDown={keepFocusInside}
        className={
          "absolute inset-y-0 left-0 w-[320px] max-w-[88%] bg-white shadow-2xl flex flex-col transition-transform duration-200 motion-reduce:transition-none " +
          (open ? "translate-x-0" : "-translate-x-full")
        }
      >
        <div className="flex items-start justify-between gap-3 pl-5 pr-3 pt-4 pb-3 border-b border-[#e7e4dc]">
          <div className="min-w-0">
            <h2 className="font-title text-[22px] leading-7 font-medium text-on-background">SDD Connect</h2>
            <p className="font-body-sm text-body-sm text-secondary">UAB SPARC · Drug discovery network</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close menu"
            onClick={() => onEvent("close_button")}
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-secondary hover:bg-surface-container-low transition-colors"
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              close
            </span>
          </button>
        </div>

        <nav aria-label="Menu" className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-5">
          {menuGroups(signedIn).map((group) => (
            <section key={group.title} aria-label={group.title} className="flex flex-col gap-1">
              <h3 className="px-2 font-label-sm text-[11px] leading-4 font-semibold uppercase tracking-wider text-secondary">{group.title}</h3>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <Item key={item.href} item={item} active={isActivePath(pathname, item.href)} onPick={pick} />
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className="border-t border-[#e7e4dc] px-4 py-3">
          {footer.kind === "signed_in" ? (
            <div className="flex items-center gap-2">
              <Link
                href={footer.href}
                onClick={pick}
                aria-current={isActivePath(pathname, footer.href) ? "page" : undefined}
                className={
                  "min-w-0 flex-1 flex items-center gap-3 min-h-11 -ml-2 px-2 py-1 rounded-xl transition-colors " +
                  (isActivePath(pathname, footer.href) ? "bg-[#f3f1ea]" : "hover:bg-surface-container-low")
                }
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 w-10 h-10 rounded-full bg-[#e4efe7] text-[#1A5632] flex items-center justify-center font-label-md text-label-md font-bold"
                >
                  {footer.initials}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="truncate font-label-md text-label-md text-on-background">{footer.name}</span>
                  <span className="font-body-sm text-body-sm text-secondary">{footer.hint}</span>
                </span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  onEvent("link");
                  onSignOut();
                }}
                className="shrink-0 min-h-11 px-2 font-label-md text-label-md text-primary underline underline-offset-4"
              >
                {footer.action}
              </button>
            </div>
          ) : (
            <Link
              href={footer.href}
              onClick={pick}
              className="btn-primary w-full min-h-11 flex items-center justify-center px-6 py-2 rounded-lg font-label-md text-label-md"
            >
              {footer.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
