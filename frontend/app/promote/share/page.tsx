// The "Share a file" screen moved to /share. This old address only forwards.

import { redirect } from "next/navigation";

export default function OldSharePage() {
  redirect("/share");
}
