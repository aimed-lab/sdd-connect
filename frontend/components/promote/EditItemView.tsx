// The owner's edit page for a Promote post — app/promote/[slug]/edit/page.tsx
// (/promote/<slug>/edit). A file share has its own, simpler "Manage file"
// screen at /files/<slug>/edit (components/promote/ManageFile.tsx) and is
// redirected there.
//
// Owner only. getOwnedArticleForEdit (lib/server/showcase.ts) returns null
// for a signed-out visitor, an unknown slug, AND a slug that belongs to
// someone else — all three 404 here, identically. That's deliberate: a
// permission error would confirm the slug exists and is someone's private
// draft; a 404 gives a prober nothing to distinguish "never existed" from
// "exists, not yours". An item asked for under the wrong area redirects to
// its own edit address.
//
// Renders the SAME ArticleEditor the submit flow hands off to.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ArticleEditor from "@/components/promote/ArticleEditor";
import { getOwnedArticleForEdit } from "@/lib/server/showcase";
import { getCommunityById, listMyActiveCommunities } from "@/lib/server/communities";
import DeleteItemButton from "@/components/promote/DeleteItemButton";
import { editPageRedirect, itemPath, type ItemArea } from "@/lib/server/promote/itemAddress";

export default async function EditItemView({ slug, area }: { slug: string; area: ItemArea }) {
  const result = await getOwnedArticleForEdit(slug);
  if (!result) notFound();

  const isFileShare = Boolean(result.entry.isFileShare);
  const elsewhere = editPageRedirect(area, slug, isFileShare);
  if (elsewhere) redirect(elsewhere);

  let communities = await listMyActiveCommunities();
  // The article's OWN community may not be in that list — the author
  // deliberately keeps this attachment after leaving (see the migration's
  // own comment on why), which means the picker otherwise wouldn't have an
  // option matching the value it's already showing. Fetched (and appended)
  // only in that one case, so the select still shows the real current
  // community rather than silently falling back to "None" the moment the
  // author reopens this form.
  if (result.entry.communityId && !communities.some((c) => c.id === result.entry.communityId)) {
    const current = await getCommunityById(result.entry.communityId);
    if (current) communities = [...communities, current];
  }

  const pageHref = itemPath(slug, isFileShare);
  const intro = isFileShare
    ? result.entry.published
      ? "This file is live. Changes save as you go — unpublish to take it back down."
      : "This file isn't public yet. Publish when you're ready."
    : result.entry.published
      ? "This article is live. Changes save as you go — unpublish to take it back down."
      : "This draft isn't public yet. Publish when you're ready.";

  return (
    <div className="max-w-[1400px] mx-auto px-margin-mobile md:px-margin-desktop py-12 md:py-16">
      <Link
        href={pageHref}
        className="inline-flex items-center gap-1 mb-8 font-label-md text-label-md text-secondary hover:text-primary transition-colors"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        {isFileShare ? "Back to the file" : "Back to article"}
      </Link>

      <div className="max-w-2xl">
        <h1 className="font-headline-lg text-headline-lg text-on-background">Edit</h1>
        <p className="mt-3 font-body-lg text-body-lg text-secondary">{intro}</p>
      </div>

      <div className="mt-10">
        <ArticleEditor
          entry={result.entry}
          media={result.media}
          communities={communities}
          doneHref={isFileShare ? "/files" : pageHref}
        />
      </div>

      {/* A hidden item (never public, or taken down) can always be deleted
          from here, with the same in-page confirmation as everywhere else. */}
      {!result.entry.published && (
        <div className="mt-10 pt-6 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-3">
          <p className="font-body-sm text-body-sm text-secondary">Not needed any more? Delete it for good.</p>
          <DeleteItemButton
            id={result.entry.id}
            title={result.entry.headline || "this item"}
            kind="post"
            afterDeleteHref="/promote?deleted=1"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-error/40 text-error font-label-md text-label-md hover:bg-error/5"
          />
        </div>
      )}
    </div>
  );
}
