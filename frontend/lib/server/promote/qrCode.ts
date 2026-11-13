// lib/server/promote/qrCode.ts — the address and file name for a published
// Promote item's QR code (components/promote/PromoteQrCard.tsx). Pure, so
// `npm test` covers it and the client component may import it.
//
// The QR encodes the item's plain public address on the CONFIGURED site
// (SITE_URL in lib/articleFormat.ts, the same base the share buttons, og:url
// and canonical use), never the host the page was opened from, so a QR
// downloaded on localhost or a preview deploy still points at the live site.
// No query string, no tracking code.

import { articleUrlFor } from "./shareText.ts";
import { itemUrlFor } from "./itemAddress.ts";

/** The address the QR code points to. `siteBase` is the configured site URL
 *  (pass SITE_URL), not window.location.origin. */
export function promoteQrUrl(siteBase: string, slug: string): string {
  return articleUrlFor(siteBase, slug);
}

/** The downloaded PNG's file name: <slug>-qr.png. */
export function promoteQrFileName(slug: string): string {
  return `${slug}-qr.png`;
}

/** The address a FILE SHARE's QR code points to: /files/<slug> on the
 *  configured site. */
export function fileShareQrUrl(siteBase: string, slug: string): string {
  return itemUrlFor(siteBase, slug, true);
}
