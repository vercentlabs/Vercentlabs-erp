import { requireWorkspace } from "@/core/session";
import { CloseReasonsSettingsScreen } from "@/features/crm/close-reasons/screens/CloseReasonsSettingsScreen";

export const metadata = { title: "Opportunity Close Reasons" };

export default async function CloseReasonsSettingsPage() {
  await requireWorkspace();
  return <CloseReasonsSettingsScreen />;
}
