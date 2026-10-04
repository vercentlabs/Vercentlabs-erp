import { requireWorkspace } from "@/core/session";
import { OpportunityListScreen } from "@/features/crm/opportunities/screens/OpportunityListScreen";

export const metadata = { title: "Opportunities" };

// The opportunity list. The same deals by sales stage are at /crm/pipeline.
export default async function Page() {
  await requireWorkspace();
  return <OpportunityListScreen />;
}
