// The results page's <title>, and the guard for /explore/<text with an email address>:
// the page itself is a client component (and is not edited here).
//
// EMAIL GUARD: a direct visit to /explore/<text containing an email address> (an old
// link, the history, a typed URL) renders a notice INSTEAD of the results page, so the
// page never mounts: no search request, nothing sent to the backend, no "Follow this
// topic", no page. The title leaves the text out. The search boxes never make such a URL
// (they hand the text to the assistant), and /api/explore refuses it as a backstop
// (lib/server/explore/emailGuard.ts).

import type { Metadata } from "next";
import EmailQueryNotice from "@/components/explore/EmailQueryNotice";
import { decodeTopicParam, topicParamHasEmail } from "@/lib/server/explore/emailGuard";

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  if (topicParamHasEmail(topic)) return { title: "Explore", robots: { index: false, follow: false } };
  const text = decodeTopicParam(topic);
  return { title: text ? `${text} · Explore` : "Explore" };
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  if (topicParamHasEmail(topic)) return <EmailQueryNotice />;
  return children;
}
