import { requireWorkspace } from "@/core/session";
import { LeadImportScreen } from "@/features/crm/leads/screens/LeadImportScreen";

export const metadata = { title: "Import leads" };

// Lead export is on the Leads list (Export), for the view and filters shown there.
export default async function CrmImportExportPage() {
  await requireWorkspace();
  return <LeadImportScreen />;
}
