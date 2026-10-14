import { requireWorkspace } from "@/core/session";
import { SalesStagesSettingsScreen } from "@/features/crm/sales-stages/screens/SalesStagesSettingsScreen";

export const metadata = { title: "Deal stages" };

export default async function Page() {
  await requireWorkspace();
  return <SalesStagesSettingsScreen />;
}
