import { redirect } from "next/navigation";

// The alert list is the Alerts tab of Replenishment.
export default function Page() {
  redirect("/inventory/replenishment?tab=alerts");
}
