import { requireWorkspace } from "@/core/session";
import { CustomFieldsAndTagsSettingsScreen } from "@/features/crm/settings/custom-fields-and-tags/screens/CustomFieldsAndTagsSettingsScreen";

export const metadata = { title: "Custom Fields & Tags" };

export default async function CustomFieldsAndTagsSettingsPage() {
  await requireWorkspace();
  return <CustomFieldsAndTagsSettingsScreen />;
}
