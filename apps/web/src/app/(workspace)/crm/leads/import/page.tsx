import { requireWorkspace } from "@/core/session";
import { LeadImportScreen } from "@/features/crm/leads/screens/LeadImportScreen";

export const metadata = { title: "Import leads" };

export default async function Page() {
  await requireWorkspace();
  return <LeadImportScreen />;
}
