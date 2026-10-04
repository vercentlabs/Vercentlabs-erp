import { redirect } from "next/navigation";

// This page moved; the old address keeps working.
export default function Page() {
  redirect("/crm/settings/leads/sources");
}
