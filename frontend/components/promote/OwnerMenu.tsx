"use client";

// "More (⋯)" for the owner on an item's own page: Edit and Delete. The delete
// uses the same confirm as the cards. A Promote post goes back to /promote with
// a "Deleted" message; a file share goes back to /files.

import { useState } from "react";
import MoreMenu from "@/components/MoreMenu";
import DeleteShowcaseConfirm from "./DeleteShowcaseConfirm";
import { afterDeletePath, itemEditPath } from "@/lib/server/promote/itemAddress";
import { DELETE_FILE_CONFIRM } from "@/lib/server/promote/manageFile";

export default function OwnerMenu({
  id,
  slug,
  title,
  isFileShare = false,
}: {
  id: string;
  slug: string;
  title: string;
  isFileShare?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <MoreMenu
        className="ml-auto shrink-0"
        buttonClassName="!text-on-primary bg-white/15 hover:!bg-white/25 !px-4 !py-2"
        items={[
          { label: "Edit", href: itemEditPath(slug, isFileShare) },
          { label: "Delete", danger: true, onClick: () => setConfirming(true) },
        ]}
      />
      {confirming && <DeleteShowcaseConfirm
          entryId={id}
          entryTitle={title}
          onClose={() => setConfirming(false)}
          afterDeleteHref={afterDeletePath(isFileShare)}
          {...(isFileShare
            ? {
                heading: DELETE_FILE_CONFIRM.heading,
                message: DELETE_FILE_CONFIRM.message,
                confirmLabel: DELETE_FILE_CONFIRM.confirm,
              }
            : {})}
        />}
    </>
  );
}
