import { requireWorkspace } from "@/core/session";
import { CrmDashboardScreen } from "@/features/crm/dashboard/screens/CrmDashboardScreen";

export const metadata = { title: "CRM Dashboard" };

export default async function CrmDashboardPage() {
  await requireWorkspace();
  return <CrmDashboardScreen />;
}
