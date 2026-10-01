import { requireWorkspace } from "@/core/session";
import { DuplicateRulesSettingsScreen } from "@/features/crm/setup/duplicate-rules/screens/DuplicateRulesSettingsScreen";

export const metadata = { title: "Duplicate Rules" };

export default async function CrmDuplicateRulesSettingsPage() {
  await requireWorkspace();
  return <DuplicateRulesSettingsScreen />;
}
