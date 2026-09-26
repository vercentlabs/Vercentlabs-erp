import { redirect } from "next/navigation";

// Privacy administration is a Shared Platform page; the old CRM address
// keeps working.
export default function LegacyCrmPrivacyPage() {
  redirect("/settings/privacy");
}
