import { requireWorkspace } from "@/core/session";
import { LeadListScreen } from "@/features/crm/leads/screens/LeadListScreen";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireWorkspace();
  return <LeadListScreen />;
}
