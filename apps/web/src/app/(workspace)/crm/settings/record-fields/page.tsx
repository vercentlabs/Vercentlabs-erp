import { requireWorkspace } from "@/core/session";
import { RecordFieldsSettingsScreen } from "@/features/crm/settings/record-fields/screens/RecordFieldsSettingsScreen";

export const metadata = { title: "Custom Record Fields" };

export default async function RecordFieldsSettingsPage() {
  await requireWorkspace();
  return <RecordFieldsSettingsScreen />;
}
