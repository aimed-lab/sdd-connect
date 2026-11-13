"use client";

// The QR code in the public item page's sidebar (app/promote/[slug]/page.tsx),
// for a presenter to put on a slide: a ~140px preview, "Scan to open this page",
// and "Download QR code" (a 1024px black-on-white PNG, <slug>-qr.png).
//
// Same approach as components/teams/TeamQrCard.tsx (the qrcode package, built
// in the browser), but the address is NOT window.location.origin: the page
// passes `url`, built from the configured site URL (itemUrlFor(SITE_URL,
// slug, isFileShare), lib/server/promote/itemAddress.ts), the same base the
// share buttons use.
// A QR downloaded on localhost or a preview deploy still opens the live site.
//
// Only rendered on the published page. /promote/[slug] 404s for a draft, and
// the edit page never renders this, because a draft's slug changes at first
// publish.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { promoteQrFileName } from "@/lib/server/promote/qrCode";

export default function PromoteQrCard({ url, slug, title }: { url: string; slug: string; title: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, {
      width: 280, // drawn at 2x the ~124px it shows at, so it stays crisp
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [url]);

  async function download() {
    // Big, pure black on white with a wide quiet zone: sharp on a projector.
    const png = await QRCode.toDataURL(url, {
      width: 1024,
      margin: 4,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const a = document.createElement("a");
    a.href = png;
    a.download = promoteQrFileName(slug);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-[140px] h-[140px] rounded-lg bg-white border border-outline-variant/40 p-2 flex items-center justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`QR code for ${title}`} width={124} height={124} className="w-full h-full" />
        ) : (
          <span className="material-symbols-outlined text-secondary/40 text-5xl">qr_code_2</span>
        )}
      </div>
      <span className="font-body-sm text-body-sm text-secondary">Scan to open this page</span>
      <button
        type="button"
        onClick={download}
        disabled={!src}
        className="btn-outline w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-label-md text-label-md disabled:opacity-40"
      >
        <span className="material-symbols-outlined text-base">qr_code_2</span>
        Download QR code
      </button>
    </div>
  );
}
