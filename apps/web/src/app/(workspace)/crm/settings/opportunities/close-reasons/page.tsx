import { requireWorkspace } from "@/core/session";
import { CloseReasonsSettingsScreen } from "@/features/crm/close-reasons/screens/CloseReasonsSettingsScreen";

export const metadata = { title: "Won and lost reasons" };

export default async function CloseReasonsSettingsPage() {
  await requireWorkspace();
  return <CloseReasonsSettingsScreen />;
}
