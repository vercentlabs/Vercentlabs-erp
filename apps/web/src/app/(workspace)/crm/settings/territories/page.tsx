import { requireWorkspace } from "@/core/session";
import { SalesOrganizationSettingsScreen } from "@/features/crm/setup/territories/screens/SalesOrganizationSettingsScreen";

export const metadata = { title: "Territories & Sales Teams" };

export default async function TerritoriesSettingsPage() {
  await requireWorkspace();
  return <SalesOrganizationSettingsScreen />;
}
