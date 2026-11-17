"use client";

// "New wiki page": opens the assistant with the request already typed, the same
// way Explore's "Your wiki" card does. The assistant's usual who-can-see-it
// choice and confirm step follow; nothing is created here.

import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { START_LIVING_PAGE_MESSAGE, openAssistant } from "@/lib/server/assistant/assistantBridge";

// Signed out, the assistant only offers sign-in, so the button says so up front
// and goes straight to sign-in, back to this page afterwards.
function useSignInHref(): string | null {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  return !loading && !user ? `/login?callbackUrl=${encodeURIComponent(pathname)}` : null;
}

export default function NewWikiPageButton({ primary = true }: { primary?: boolean }) {
  const signInHref = useSignInHref();
  const cls =
    (primary ? "btn-primary" : "btn-outline") + " inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md";
  if (signInHref) {
    return (
      <a href={signInHref} className={cls}>
        <span className="material-symbols-outlined text-[20px]">login</span>
        Sign in to make a wiki page
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openAssistant({ text: START_LIVING_PAGE_MESSAGE, mode: "send" })}
      className={
        (primary ? "btn-primary" : "btn-outline") +
        " inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
      }
    >
      <span className="material-symbols-outlined text-[20px]">add</span>
      New wiki page
    </button>
  );
}

/** The wiki page's one main button: opens the assistant with a question about this page's topic ready to finish. */
export function AskAssistantButton({ title }: { title: string }) {
  const signInHref = useSignInHref();
  if (signInHref) {
    return (
      <a href={signInHref} className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md">
        <span className="material-symbols-outlined text-[20px]">login</span>
        Sign in to ask the assistant
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openAssistant({ text: `About my wiki page "${title.slice(0, 120)}": `, mode: "fill" })}
      className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
    >
      <span className="material-symbols-outlined text-[20px]">chat</span>
      Ask the assistant
    </button>
  );
}
