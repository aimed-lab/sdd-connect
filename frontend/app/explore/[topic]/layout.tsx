// Only here to give the results page its <title>: the page itself is a client component.

import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic } = await params;
  let text = topic;
  try {
    text = decodeURIComponent(topic);
  } catch {}
  text = text.trim();
  return { title: text ? `${text} · Explore` : "Explore" };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
