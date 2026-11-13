// The public page of one published item, shared by two routes:
//   app/promote/[slug]/page.tsx  a Promote post   (/promote/<slug>)
//   app/files/[slug]/page.tsx    a file share     (/files/<slug>)
// Each route loads the item with getPublishedArticleBySlug (ANON client, so a
// draft never renders here), sends the wrong kind to the other address, and
// hands the item to this view. Every address on the page (share buttons, QR
// code, link preview card, Edit, downloads) comes from itemAddress.ts, so a
// file share always points at /files/<slug> and a post at /promote/<slug>.
//
// LAYOUT (top to bottom):
//   1. A green hero: the type label, headline, standfirst, authors / presenters,
//      date and read time.
//   2. The key-facts strip: three labelled facts, overlapping the bottom of the
//      hero. Hidden when the item has none.
//   3. The body: the article text in sections, the figures and attached files,
//      and an author quote ONLY when the author entered one (the page never
//      writes a quote, a personal statement or a name for one).
//   4. A sidebar: the main button, "Download visual card", Share, "Want to work
//      with this team?" (the Collaborate flow) and "Follow the topic" (the best
//      matching wiki page and community; hidden when there is none).
//
// Link previews: the 1200x630 card (opengraph-image.tsx / twitter-image.tsx next
// to this file) is the og:image and twitter:image; og:url and the canonical use
// the site URL config (lib/articleFormat.ts), never a hardcoded host.

import { teamLabelHref } from "@/lib/server/teams/teamRules";
import type { Metadata } from "next";
import Link from "next/link";
import { isOwnerOfShowcase } from "@/lib/server/showcase";
import { findFollowTopic } from "@/lib/server/promote/followTopic";
import { eventBadge, visibleFacts } from "@/lib/server/promote/showcaseKinds";
import { SITE_URL, estimateReadMinutes, formatPublishedDate } from "@/lib/articleFormat";
import { itemCardImagePath, itemCardImageUrlFor, itemUrlFor } from "@/lib/server/promote/itemAddress";
import OwnerMenu from "@/components/promote/OwnerMenu";
import { SHOWCASE_TYPE_LABEL, type PublicArticle } from "@/lib/showcaseTypes";
import ShareButtons from "@/components/promote/ShareButtons";
import PromoteQrCard from "@/components/promote/PromoteQrCard";
import { fileDownloadHref, formatFileSize } from "@/lib/server/promote/mediaFiles";
import { downloadButtonFor, paperDetailsLine } from "@/lib/server/promote/quickShare";


// Turn the "## Heading\n\nparagraph" body into headings + paragraphs. Not a
// markdown library: the shape is fixed (known section headings, blank-line
// separated paragraphs), so a couple of string splits cover it.
function renderBody(body: string) {
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block, i) => {
    if (block.startsWith("## ")) {
      return (
        <h2 key={i} className="font-headline-md text-headline-md text-primary mt-10 mb-3 first:mt-0">
          {block.slice(3).trim()}
        </h2>
      );
    }
    return (
      <p
        key={i}
        className="font-body-lg text-[18px] leading-[1.7] text-on-background/90 mb-5 whitespace-pre-wrap"
      >
        {block}
      </p>
    );
  });
}

/** The page's metadata: title, description, canonical, og:url and the link
 *  preview card, all on the item's own address. */
export function itemPageMetadata(article: PublicArticle): Metadata {
  const url = itemUrlFor(SITE_URL, article.slug, article.isFileShare);
  // The card (route: <item address>/opengraph-image) as an ABSOLUTE url built
  // from the site URL config, so og:image and twitter:image never take the
  // request host.
  const image = itemCardImageUrlFor(SITE_URL, article.slug, article.isFileShare);
  return {
    metadataBase: new URL(SITE_URL),
    title: article.headline,
    description: article.standfirst || undefined,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: "SmartDrugDiscovery",
      title: article.headline,
      description: article.standfirst || undefined,
      images: [{ url: image, width: 1200, height: 630, alt: article.headline }],
    },
    twitter: {
      card: "summary_large_image",
      title: article.headline,
      description: article.standfirst || undefined,
      images: [image],
    },
  };
}

export default async function ItemPageView({ article }: { article: PublicArticle }) {
  const slug = article.slug;

  // Owner-only "Edit" link: a separate, session-scoped check, so it can never
  // affect what the public read returns.
  const [isOwner, found] = await Promise.all([
    isOwnerOfShowcase(slug),
    findFollowTopic(article.headline, article.tags, article.standfirst, slug),
  ]);
  // The community the author attached the item to is always shown; a matched
  // one is the fallback.
  const follow = {
    page: found.page,
    // A team the viewer is not on shows by name only (no slug, no link).
    community: article.community
      ? article.community.slug && article.community.kind === "community"
        ? { slug: article.community.slug, name: article.community.name }
        : null
      : found.community,
  };

  const typeLabel = SHOWCASE_TYPE_LABEL[article.type];
  const facts = visibleFacts(article.keyFacts);
  const readMinutes = estimateReadMinutes(article.standfirst, article.articleBody);
  const url = itemUrlFor(SITE_URL, article.slug, article.isFileShare);
  const badge = article.type === "event" ? eventBadge(article.eventStartsAt) : null;

  const images = article.media.filter((m) => m.kind === "image");
  // Slides and other files: listed for download only, never previewed inline.
  const files = article.media.filter((m) => m.kind !== "image");
  const hero = images[0]?.url ?? article.image_url ?? null;
  const extraImages = hero && images[0]?.url === hero ? images.slice(1) : images;

  // No body text = a download page ("Share a file"), not an article: files
  // first, then the paper they come from, no reading time. Items with body
  // text render exactly as before.
  const isDownloadPage = !article.articleBody.trim();
  const paperHref = article.link || (article.doi ? `https://doi.org/${article.doi}` : null);

  // The main button: on a download page it downloads (one file) or jumps to
  // the Files list (several), never the paper. Otherwise unchanged.
  const mainButton = isDownloadPage
    ? downloadButtonFor(article.slug, files.map((m) => m.id))
    : null;
  const sharedBy = isDownloadPage ? article.owner?.name?.trim() || null : null;

  const byline = (
    isDownloadPage
      ? [article.publishedAt ? formatPublishedDate(article.publishedAt) : null]
      : [
          article.authors || null,
          article.publishedAt ? formatPublishedDate(article.publishedAt) : null,
          `${readMinutes} min read`,
        ]
  )
    .filter(Boolean)
    .join(" · ");

  const workTitle = `Working with the team behind: ${article.headline}`.slice(0, 120);
  const workDescription = `I read "${article.headline}" (${url}) and would like to talk about working together.`;
  const collaborateHref = `/collaborate/new?title=${encodeURIComponent(workTitle)}&description=${encodeURIComponent(workDescription)}`;

  // Slides and other files, for download. A plain <a> to the permanent link.
  const filesSection =
    files.length > 0 ? (
      <div id="files" className="mt-8 scroll-mt-24">
        <h2 className="font-label-md text-label-md text-secondary uppercase mb-3">Files</h2>
        <ul className="space-y-2">
          {files.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-label-md text-label-md text-on-background break-all">
                  {m.filename}
                  <span className="ml-2 text-secondary font-body-sm text-body-sm">
                    {formatFileSize(m.sizeBytes)}
                  </span>
                </p>
                {m.label && (
                  <p className="mt-0.5 font-body-sm text-body-sm text-secondary">{m.label}</p>
                )}
              </div>
              {/* A plain <a>, not next/link: the route answers with a
                  redirect to a signed download URL, which must not be
                  prefetched or handled by the client router. */}
              <a
                href={fileDownloadHref(article.slug, m.id)}
                className={`${isDownloadPage ? "btn-primary" : "btn-outline"} shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-label-md text-label-md`}
              >
                <span className="material-symbols-outlined text-base">download</span>
                Download
              </a>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const paperCard =
    paperHref && article.title ? (
      <section className="mt-8 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5">
        <h2 className="font-label-md text-label-md text-secondary uppercase">From the paper</h2>
        <p className="mt-2 font-title text-[18px] font-medium text-on-background">{article.title}</p>
        {paperDetailsLine(article.authors, article.journal, article.paperYear) && (
          <p className="mt-1 font-body-sm text-body-sm text-secondary">
            {paperDetailsLine(article.authors, article.journal, article.paperYear)}
          </p>
        )}
        <a
          href={paperHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          Read the paper
          <span className="material-symbols-outlined text-base">arrow_outward</span>
        </a>
      </section>
    ) : null;

  const allImages = hero ? [{ id: "hero", url: hero }, ...extraImages] : extraImages;

  const sidebar = (
    <div className="space-y-6">
      {/* The box always renders. With no link anywhere (the type's link, the
          DOI, an attached deck or a link written in the text) only the main
          button is left out. */}
      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5 space-y-4">
        {isDownloadPage ? (
          mainButton && (
            // A plain <a>: the permanent link redirects to a signed download.
            <a
              href={mainButton.href}
              className="btn-primary w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-label-md text-label-md"
            >
              <span className="material-symbols-outlined text-base">download</span>
              {mainButton.label}
            </a>
          )
        ) : (
          article.cta && (
            <a
              href={article.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-label-md text-label-md"
            >
              {article.cta.label}
              <span className="material-symbols-outlined text-base">arrow_outward</span>
            </a>
          )
        )}

        <a
          href={itemCardImagePath(article.slug, article.isFileShare)}
          download={`${article.slug}-card.png`}
          className="btn-outline w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-label-md text-label-md"
        >
          <span className="material-symbols-outlined text-base">download</span>
          Download visual card
        </a>

        {/* Only published items reach this page (a draft 404s above). */}
        <PromoteQrCard url={url} slug={article.slug} title={article.headline} />

        <ShareButtons url={url} title={article.headline} shareText={article.shareText} layout="column" />
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5">
        <h2 className="font-title text-[18px] font-medium text-on-background">Want to work with this team?</h2>
        <p className="mt-1.5 font-body-sm text-body-sm text-secondary">
          Start a conversation through Collaborate and say what you have in mind.
        </p>
        <Link
          href={collaborateHref}
          className="mt-3 inline-flex items-center gap-1 font-label-md text-label-md text-primary hover:underline underline-offset-4"
        >
          Get in touch
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </Link>
      </section>

      {(follow.page || follow.community) && (
        <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-5">
          <h2 className="font-title text-[18px] font-medium text-on-background">Follow the topic</h2>
          <ul className="mt-3 space-y-2.5">
            {follow.page && (
              <li>
                <Link
                  href={`/pages/${follow.page.slug}`}
                  className="flex items-start gap-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  <span className="material-symbols-outlined text-base shrink-0">auto_stories</span>
                  {follow.page.title}
                </Link>
              </li>
            )}
            {follow.community && (
              <li>
                <Link
                  href={`/communities/${follow.community.slug}`}
                  className="flex items-start gap-2 font-label-md text-label-md text-primary hover:underline underline-offset-4"
                >
                  <span className="material-symbols-outlined text-base shrink-0">groups</span>
                  {follow.community.name}
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );

  return (
    <div className="bg-[var(--explore-bg)]">
      {/* 1. Hero */}
      <div className="bg-primary text-on-primary">
        <div
          className={
            "max-w-[1100px] mx-auto px-margin-mobile md:px-margin-desktop pt-12 md:pt-16 " +
            (facts.length > 0 ? "pb-24 md:pb-28" : "pb-12 md:pb-16")
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-white/15 font-label-sm text-label-sm uppercase tracking-wide">
              {typeLabel}
            </span>
            {article.community &&
              (teamLabelHref(article.community) ? (
                <Link
                  href={teamLabelHref(article.community) as string}
                  className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors font-label-sm text-label-sm"
                >
                  {article.community.name}
                </Link>
              ) : (
                <span className="px-3 py-1 rounded-full bg-white/10 font-label-sm text-label-sm">
                  {article.community.name}
                </span>
              ))}
            {isOwner && (
              <OwnerMenu id={article.id} slug={article.slug} title={article.headline} isFileShare={article.isFileShare} />
            )}
          </div>

          <h1 className="mt-5 max-w-3xl font-headline-lg text-[32px] leading-[1.15] md:text-[44px]">
            {article.headline}
          </h1>

          {article.standfirst && (
            <p className="mt-4 max-w-3xl font-body-lg text-[20px] leading-[1.5] text-on-primary/90">
              {article.standfirst}
            </p>
          )}

          {(badge || article.eventLocation) && (
            <p className="mt-4 flex items-center gap-2 font-label-md text-label-md text-on-primary/90">
              <span className="material-symbols-outlined text-base">event</span>
              {[badge ? `${badge.month} ${badge.day}` : null, article.eventLocation].filter(Boolean).join(" · ")}
            </p>
          )}

          <p className="mt-4 font-body-sm text-body-sm text-on-primary/80">
            {byline}
            {sharedBy && (
              <>
                {byline ? " · " : ""}
                Shared by{" "}
                {article.ownerProfileSlug ? (
                  <Link
                    href={`/researchers/${article.ownerProfileSlug}`}
                    className="underline underline-offset-4 hover:text-on-primary"
                  >
                    {sharedBy}
                  </Link>
                ) : (
                  sharedBy
                )}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-margin-mobile md:px-margin-desktop pb-20">
        {/* 2. Key facts, overlapping the hero */}
        {facts.length > 0 && (
          <dl className="relative -mt-14 md:-mt-16 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            {facts.map((f) => (
              <div
                key={f.label}
                className="rounded-2xl bg-white border border-outline-variant/30 shadow-sm p-5 min-w-0"
              >
                <dt className="font-label-sm text-label-sm uppercase tracking-wide text-primary">{f.label}</dt>
                <dd className="mt-1.5 font-body-md text-body-md text-on-background break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-10 lg:gap-14 items-start">
          {/* 3. Body */}
          {isDownloadPage ? (
          <article className="min-w-0 max-w-[680px]">
            {filesSection}
            {paperCard}

            {article.quote && (
              <figure className="my-10 border-l-4 border-primary pl-6">
                <blockquote className="font-title text-[24px] leading-snug text-on-background">
                  &ldquo;{article.quote}&rdquo;
                </blockquote>
                {article.quoteBy && (
                  <figcaption className="mt-3 font-label-md text-label-md text-secondary">
                    {article.quoteBy}
                  </figcaption>
                )}
              </figure>
            )}

            {allImages.length > 0 && (
              <div className="mt-8 space-y-6">
                {allImages.map((m) => (
                  <div key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="" className="max-w-full max-h-[70vh] w-auto h-auto rounded-2xl" />
                  </div>
                ))}
              </div>
            )}
          </article>
          ) : (
          <article className="min-w-0 max-w-[680px]">
            {hero && (
              <div className="mb-8">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hero} alt="" className="max-w-full max-h-[70vh] w-auto h-auto rounded-2xl" />
              </div>
            )}

            <div>{renderBody(article.articleBody)}</div>

            {/* Only a quote the author typed; nothing is written for them. */}
            {article.quote && (
              <figure className="my-10 border-l-4 border-primary pl-6">
                <blockquote className="font-title text-[24px] leading-snug text-on-background">
                  &ldquo;{article.quote}&rdquo;
                </blockquote>
                {article.quoteBy && (
                  <figcaption className="mt-3 font-label-md text-label-md text-secondary">
                    {article.quoteBy}
                  </figcaption>
                )}
              </figure>
            )}

            {extraImages.length > 0 && (
              <div className="mt-8 space-y-6">
                {extraImages.map((m) => (
                  <div key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="" className="max-w-full max-h-[70vh] w-auto h-auto rounded-2xl" />
                  </div>
                ))}
              </div>
            )}

            {filesSection}
          </article>
          )}

          {/* 4. Sidebar */}
          <aside className="lg:sticky lg:top-24">{sidebar}</aside>
        </div>
      </div>
    </div>
  );
}
