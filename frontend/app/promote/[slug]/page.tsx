// Public page of a Promote post — /promote/[slug].
//
// PUBLIC, no account required: getPublishedArticleBySlug (lib/server/showcase.ts)
// reads through the ANON Supabase client, never the session client, so this page
// can never leak an unpublished draft through a signed-in owner's cookies. An
// unknown slug OR an unpublished one both 404.
//
// A FILE SHARE lives at /files/<slug>; asked for here, it redirects there. The
// page itself is components/promote/ItemPageView.tsx, shared with /files/<slug>.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import ItemPageView, { itemPageMetadata } from "@/components/promote/ItemPageView";
import { itemPageRedirect } from "@/lib/server/promote/itemAddress";
import { getPublishedArticleBySlug } from "@/lib/server/showcase";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article || article.isFileShare) return {};
  return itemPageMetadata(article);
}

export default async function PromoteItemPage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();

  const elsewhere = itemPageRedirect("promote", article.slug, article.isFileShare);
  if (elsewhere) redirect(elsewhere);

  return <ItemPageView article={article} />;
}
