"use client";

// "Team created. You are its Lead." on the first visit after creating a team
// (?created=1, plus ?skipped=N for emails that couldn't be added).
//
// A client component so the notice can stay up after the one-time params are
// removed from the URL: it keeps the value it mounted with, and the page
// renders it in the same place on every render, so the server re-render that
// router.replace causes doesn't unmount it.
//
// It removes ?created / ?skipped itself (through the router, see cleanTeamUrl)
// unless the creation wiki request is about to be sent: then TeamTiles cleans
// the URL right after sending, because cleaning it first would cancel the send.
// sessionStorage "team-created-shown:<slug>" keeps it from coming back on a
// reload of an old ?created=1 URL in this browser session.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cleanTeamUrl,
  createdShownKey,
  hasTeamOneTimeParams,
  markOnceDone,
  onceDone,
  runOnceAfterMount,
  sessionStore,
} from "@/lib/server/teams/teamWorkRules";

export default function TeamCreatedNotice({
  slug,
  created,
  skipped,
  learnPending,
}: {
  slug: string;
  /** ?created=1 on this render. */
  created: boolean;
  /** ?skipped=N on this render. */
  skipped: number;
  /** TeamTiles will send the creation wiki request and clean the URL itself. */
  learnPending: boolean;
}) {
  const router = useRouter();
  // The first render's values; later renders (after the URL is cleaned) don't change them.
  const [show, setShow] = useState(created);
  const [skippedAtStart] = useState(skipped);
  const handled = useRef(false);

  useEffect(() => {
    if (!created) return;
    return runOnceAfterMount(handled, () => {
      const storage = sessionStore();
      const key = createdShownKey(slug);
      if (onceDone(storage, key)) setShow(false);
      else markOnceDone(storage, key);
      if (learnPending) return;
      const { pathname, search, hash } = window.location;
      if (hasTeamOneTimeParams(search)) router.replace(cleanTeamUrl(pathname, search, hash), { scroll: false });
    });
  }, [created, learnPending, slug, router]);

  if (!show) return null;
  return (
    <p role="status" className="rounded-xl bg-surface-container-low text-primary px-4 py-3 font-body-md text-body-md">
      Team created. You are its Lead. Scan or share the QR code to bring people in.
      {skippedAtStart > 0
        ? ` ${skippedAtStart} email${skippedAtStart === 1 ? "" : "s"} could not be added; try them again in Team settings.`
        : ""}
    </p>
  );
}
