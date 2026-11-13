// Shared files — /files. The home of file shares (datasets, slides, tools made
// on /share), apart from the Promote news feed.
//
//   "Your files"       signed in only: your own file shares, public or hidden,
//                      with Open (public only), Edit and Delete
//                      (listMyFileShares, session client, your own rows only).
//   "Recently shared"  everyone's PUBLIC file shares, newest first, for every
//                      visitor (listRecentFileShares, ANON client, so a hidden
//                      one never shows here).
//
// Wording: "Public" and "Hidden", never "Published" or "Draft".

import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import DeleteItemButton from "@/components/promote/DeleteItemButton";
import { getCurrentUser } from "@/lib/auth";
import { formatPublishedDate } from "@/lib/articleFormat";
import { fileShareTypeLabel, itemEditPath, itemPath } from "@/lib/server/promote/itemAddress";
import { FILE_DELETED_NOTICE, fileVisibilityTag } from "@/lib/server/promote/manageFile";
import { listMyFileShares, listRecentFileShares, type FileShareListItem } from "@/lib/server/showcase";

export const dynamic = "force-dynamic"; // "Your files" depends on the session

export const metadata: Metadata = { title: "Shared files" };

function Meta({ parts }: { parts: (string | null | undefined)[] }) {
  const text = parts.filter(Boolean).join(" · ");
  return text ? <p className="mt-0.5 font-body-sm text-body-sm text-secondary">{text}</p> : null;
}

function YourFileRow({ item }: { item: FileShareListItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-label-md text-label-md text-on-background break-words">{item.title}</span>
          <span
            className={
              "px-2 py-0.5 rounded-full font-label-sm text-label-sm " +
              (item.published ? "bg-primary/10 text-primary" : "bg-surface-container-high text-secondary")
            }
          >
            {fileVisibilityTag(item.published)}
          </span>
        </div>
        <Meta parts={[fileShareTypeLabel(item.type), formatPublishedDate(item.date)]} />
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {item.published && (
          <Link
            href={itemPath(item.slug, true)}
            className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
          >
            Open
          </Link>
        )}
        <Link
          href={itemEditPath(item.slug, true)}
          className="font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          Edit
        </Link>
        <DeleteItemButton id={item.id} title={item.title} kind="file" afterDeleteHref="/files?deleted=1" />
      </div>
    </li>
  );
}

function RecentFileRow({ item }: { item: FileShareListItem }) {
  return (
    <li>
      <Link
        href={itemPath(item.slug, true)}
        className="block rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3 hover:border-primary/40 transition-colors"
      >
        <span className="font-label-md text-label-md text-on-background break-words">{item.title}</span>
        <Meta
          parts={[
            fileShareTypeLabel(item.type),
            item.ownerName ? `Shared by ${item.ownerName}` : null,
            formatPublishedDate(item.date),
          ]}
        />
        {item.paperTitle && (
          <p className="mt-0.5 font-body-sm text-body-sm text-secondary">From the paper: {item.paperTitle}</p>
        )}
      </Link>
    </li>
  );
}

export default async function SharedFilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const deleted = sp.deleted === "1";
  const user = await getCurrentUser();
  const [mine, recent] = await Promise.all([
    user ? listMyFileShares() : Promise.resolve([] as FileShareListItem[]),
    listRecentFileShares(),
  ]);

  return (
    <div className="max-w-[1100px] mx-auto px-margin-mobile md:px-margin-desktop py-10 md:py-12">
      <PageHeader
        title="Shared files"
        subtitle="Datasets, slides and tools that researchers have shared, each with a link anyone can open."
        action={
          <Link
            href="/share"
            className="btn-primary shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-label-md text-label-md"
          >
            <span className="material-symbols-outlined">upload_file</span>
            Share a file
          </Link>
        }
      />

      {deleted && (
        <p
          className="mb-6 flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2.5 font-body-sm text-body-sm text-primary"
          role="status"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            check_circle
          </span>
          {FILE_DELETED_NOTICE}
        </p>
      )}

      {user && (
        <section className="mb-10">
          <h2 className="font-headline-md text-headline-md text-on-background mb-3">Your files</h2>
          {mine.length > 0 ? (
            <ul className="space-y-2">
              {mine.map((item) => (
                <YourFileRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="font-body-md text-body-md text-secondary">You haven&apos;t shared a file yet.</p>
          )}
        </section>
      )}

      <section>
        <h2 className="font-headline-md text-headline-md text-on-background mb-3">Recently shared</h2>
        {recent.length > 0 ? (
          <ul className="space-y-2">
            {recent.map((item) => (
              <RecentFileRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="font-body-md text-body-md text-secondary">Nothing shared yet.</p>
        )}
      </section>
    </div>
  );
}
