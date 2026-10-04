import { requireWorkspace } from "@/core/session";
import { OpportunityDashboardScreen } from "@/features/crm/opportunities/screens/OpportunityDashboardScreen";

export const metadata = { title: "Opportunity dashboard" };

export default async function Page() {
  await requireWorkspace();
  return <OpportunityDashboardScreen />;
}
