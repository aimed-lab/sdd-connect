// Any unknown URL, and every notFound() call. Rendered inside the root layout, so
// the nav, footer and a single <title> come with it.

import Link from "next/link";
import PageHeader, { PageShell } from "@/components/PageHeader";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PageShell narrow className="space-y-6">
      <PageHeader title="Page not found" subtitle="This page doesn't exist or has moved." className="mb-2" />
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="btn-primary px-6 py-2.5 rounded-lg font-label-md text-label-md">
          Go to the home page
        </Link>
        <Link href="/explore" className="btn-outline px-6 py-2.5 rounded-lg font-label-md text-label-md">
          Explore
        </Link>
      </div>
    </PageShell>
  );
}
