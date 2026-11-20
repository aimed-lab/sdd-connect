// lib/server/explore/emailGuard.ts — Explore never searches text that contains an email
// address. Pure, so `npm test` covers it.
//
// Where it applies:
//   * the search boxes (components/explore/QuestionBox.tsx): typed text with an email is
//     handed to the assistant panel instead of becoming /explore/<text>;
//   * a direct visit to /explore/<text with an email> (app/explore/[topic]/layout.tsx):
//     a notice instead of the results page, so no search runs and nothing is sent;
//   * /api/explore and /api/explore/stream (lib/server/explore/explorePayload.ts): a 400
//     before the backend is called (the backstop);
//   * the assistant panel's page context (assistantReply.ts): never a topic with an email.

import { hasEmailAddress } from "../assistant/actionIntent.ts";

export const EXPLORE_EMAIL_NOTICE = "Explore doesn't search email addresses";

/** The 400 message from the two search routes. */
export const EXPLORE_EMAIL_MESSAGE =
  "Explore doesn't search email addresses. To add someone to a team or project, ask the assistant.";

/** True when this search text contains an email address. */
export function exploreTextHasEmail(text: string | null | undefined): boolean {
  return hasEmailAddress(text ?? "");
}

/** The decoded /explore/<topic> segment (as Next passes it), or the raw text when it
 *  is not valid percent-encoding. */
export function decodeTopicParam(raw: string | null | undefined): string {
  const t = raw ?? "";
  try {
    return decodeURIComponent(t).trim();
  } catch {
    return t.trim();
  }
}

/** True when /explore/<topic> must not search: the decoded topic has an email address.
 *  Checks the raw segment too, in case it is encoded twice. */
export function topicParamHasEmail(raw: string | null | undefined): boolean {
  const once = decodeTopicParam(raw);
  return exploreTextHasEmail(once) || exploreTextHasEmail(decodeTopicParam(once)) || exploreTextHasEmail(raw);
}
