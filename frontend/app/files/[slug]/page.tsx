// Public page of a shared file — /files/[slug].
//
// PUBLIC, no account required. Same loading and rules as /promote/[slug]: the
// item is read through the ANON client (getPublishedArticleBySlug), so a draft
// or an unknown slug 404s. A normal Promote post asked for here redirects to
// /promote/<slug>. The page itself is components/promote/ItemPageView.tsx; an
// item with no body text renders as a download page.

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
  if (!article || !article.isFileShare) return {};
  return itemPageMetadata(article);
}

export default async function FileSharePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) notFound();

  const elsewhere = itemPageRedirect("files", article.slug, article.isFileShare);
  if (elsewhere) redirect(elsewhere);

  return <ItemPageView article={article} />;
}
