import { requireWorkspace } from "@/core/session";
import { CustomFieldsScreen } from "@/features/crm/settings/screens/CustomFieldsScreen";

export const metadata = { title: "Custom fields" };

export default async function Page() {
  await requireWorkspace();
  return <CustomFieldsScreen />;
}
