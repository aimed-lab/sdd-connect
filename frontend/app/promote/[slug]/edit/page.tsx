// Edit an existing Promote post — /promote/[slug]/edit. Owner only; a file
// share redirects to /files/<slug>/edit. See components/promote/EditItemView.tsx.

import EditItemView from "@/components/promote/EditItemView";

export const dynamic = "force-dynamic"; // depends on the session

export default async function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <EditItemView slug={slug} area="promote" />;
}
