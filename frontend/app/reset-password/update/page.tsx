// /reset-password/update — retired 2026-11-17. See ../page.tsx.

import { redirect } from "next/navigation";

export default function UpdatePasswordPage() {
  redirect("/login");
}
