"use client";

// An in-page confirmation (never a browser dialog), in the same style as the
// Delete confirmation (DeleteShowcaseConfirm.tsx): overlay, role="dialog",
// Esc or Cancel to close, focus on open. Used to confirm removing a file on
// the file sharing screens.

import { useEffect, useRef, useState } from "react";

export default function ConfirmDialog({
  heading,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  heading: string;
  message: string;
  confirmLabel: string;
  /** Runs on confirm; the dialog closes when it settles. */
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = async () => {
    if (working) return;
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-on-background/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-container-lowest rounded-t-3xl sm:rounded-2xl shadow-2xl outline-none p-6"
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-2xl text-error shrink-0">warning</span>
          <div className="min-w-0">
            <h2 className="font-headline-md text-headline-md text-on-background">{heading}</h2>
            <p className="mt-2 font-body-md text-body-md text-secondary">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="btn-outline px-6 py-3 rounded-lg font-label-md text-label-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={working}
            className="px-6 py-3 rounded-lg font-label-md text-label-md text-on-error bg-error disabled:opacity-50"
          >
            {working ? "Removing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
