// "Manage file" — /files/[slug]/edit, for the owner of a file share. See
// components/promote/ManageFile.tsx. Same column and gate as /share.
//
// Owner only: getOwnedFileShare returns null for a signed-out visitor, an
// unknown slug and someone else's item alike, and all three 404 (a
// permission error would confirm the slug exists). A normal Promote post
// asked for here goes to its own editor at /promote/<slug>/edit.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ManageFile from "@/components/promote/ManageFile";
import { editPageRedirect } from "@/lib/server/promote/itemAddress";
import { getOwnedFileShare } from "@/lib/server/showcase";

export const dynamic = "force-dynamic"; // depends on the session

export const metadata: Metadata = { title: "Manage file" };

export default async function ManageFilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = await getOwnedFileShare(slug);
  if (!item) notFound();

  const elsewhere = editPageRedirect("files", item.slug, item.isFileShare);
  if (elsewhere) redirect(elsewhere);

  return (
    <div className="max-w-[1400px] mx-auto px-margin-mobile md:px-margin-desktop py-6 md:py-8">
      <Link
        href="/files"
        className="inline-flex items-center gap-1 mb-4 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Shared files
      </Link>

      <div className="w-full max-w-xl mx-auto">
        <ManageFile item={item} />
      </div>
    </div>
  );
}
