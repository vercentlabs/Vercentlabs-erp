import { requireWorkspace } from "@/core/session";
import { LeadDashboardScreen } from "@/features/crm/leads/screens/LeadDashboardScreen";

export const metadata = { title: "Lead dashboard" };

export default async function Page() {
  await requireWorkspace();
  return <LeadDashboardScreen />;
}
