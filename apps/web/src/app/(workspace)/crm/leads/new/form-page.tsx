import { requireWorkspace } from "@/core/session";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  await requireWorkspace();
  return <LeadFormScreen />;
}
