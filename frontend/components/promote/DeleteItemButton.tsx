"use client";

// A red "Delete" button that opens the in-page delete confirmation
// (DeleteShowcaseConfirm.tsx; never a browser dialog). Used on "Manage file",
// on each "Your files" row on /files, and for a hidden Promote post on its
// edit page. After deleting it goes to `afterDeleteHref`.

import { useState } from "react";
import DeleteShowcaseConfirm from "@/components/promote/DeleteShowcaseConfirm";
import { DELETE_FILE_CONFIRM } from "@/lib/server/promote/manageFile";

export default function DeleteItemButton({
  id,
  title,
  kind,
  afterDeleteHref,
  className = "font-label-md text-label-md text-error hover:underline underline-offset-4",
  label = "Delete",
}: {
  id: string;
  title: string;
  /** "file": the file page wording; "post": the Promote wording. */
  kind: "file" | "post";
  afterDeleteHref: string;
  className?: string;
  label?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className={className}>
        {label}
      </button>
      {confirming && (
        <DeleteShowcaseConfirm
          entryId={id}
          entryTitle={title}
          onClose={() => setConfirming(false)}
          afterDeleteHref={afterDeleteHref}
          {...(kind === "file"
            ? {
                heading: DELETE_FILE_CONFIRM.heading,
                message: DELETE_FILE_CONFIRM.message,
                confirmLabel: DELETE_FILE_CONFIRM.confirm,
              }
            : { confirmLabel: "Delete" })}
        />
      )}
    </>
  );
}
