import { requireWorkspace } from "@/core/session";
import { CrmReportsScreen } from "@/features/crm/reports/screens/CrmReportsScreen";

export const metadata = { title: "CRM Reports" };

export default async function CrmReportsPage() {
  await requireWorkspace();
  return <CrmReportsScreen />;
}
