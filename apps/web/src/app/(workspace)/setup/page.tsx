import { redirect } from "next/navigation";

// The old setup wizard's address: its company details live in Settings › Company now, so old links and bookmarks still work.
export default function SetupPage() {
  redirect("/settings/organization");
}
