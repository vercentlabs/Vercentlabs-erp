import { requireWorkspace } from "@/core/session";
import { OpportunityListScreen } from "@/features/crm/opportunities/screens/OpportunityListScreen";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage() {
  await requireWorkspace();
  return <OpportunityListScreen />;
}
