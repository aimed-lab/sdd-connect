// /projects/<id>/files/<file id> — the stable, members-only link for one file
// shared in a project (lib/server/projectFiles.ts).
//
// On every visit: the visitor must be signed in AND have a project_members row
// for this project. A member is redirected to a fresh 60-second signed URL
// that downloads under the original filename; the link itself is never a
// storage URL, so forwarding it gives a non-member nothing. Anyone else gets a
// plain screen saying why (no project or file details on it), not a raw error.
//
// force-dynamic: rendered per request, so Next sends
// "Cache-Control: private, no-cache, no-store" and neither the browser nor a
// CDN keeps the redirect (it would point at a URL that stops working a minute
// later).

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProjectFileDownloadUrl } from "@/lib/server/projectFiles";
import { FileAccessNotice } from "@/components/projects/workspace/AccessScreens";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Project file", robots: { index: false, follow: false } };

export default async function ProjectFilePage({ params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params;
  const returnPath = `/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`;
  const projectPath = `/projects/${encodeURIComponent(id)}?tab=files`;

  let result: Awaited<ReturnType<typeof getProjectFileDownloadUrl>>;
  try {
    result = await getProjectFileDownloadUrl(id, fileId);
  } catch (e) {
    console.error("project file download failed", e);
    result = { status: "error" };
  }

  // Outside the try: redirect() works by throwing.
  if (result.status === "ok") redirect(result.url);

  const user = result.status === "not_member" ? await getCurrentUser() : null;
  return <FileAccessNotice reason={result.status} returnPath={returnPath} projectPath={projectPath} email={user?.email ?? null} />;
}
