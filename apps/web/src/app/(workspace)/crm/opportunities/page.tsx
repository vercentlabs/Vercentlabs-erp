import { requireWorkspace } from "@/core/session";
import { OpportunityListScreen } from "@/features/crm/opportunities/screens/OpportunityListScreen";

export const metadata = { title: "Opportunities" };

// One Opportunities workspace with two layouts of the same records: the list
// (default) and the stage board (?layout=board). /crm/pipeline opens the board.
export default async function Page() {
  await requireWorkspace();
  return <OpportunityListScreen />;
}
