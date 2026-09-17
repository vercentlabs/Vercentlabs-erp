import { requireWorkspace } from "@/core/session";
import { SalesOrganizationSettingsScreen } from "@/features/crm/settings/territories/screens/SalesOrganizationSettingsScreen";

export const metadata = { title: "Territories & Sales Teams" };

export default async function TerritoriesSettingsPage() {
  await requireWorkspace();
  return <SalesOrganizationSettingsScreen />;
}
