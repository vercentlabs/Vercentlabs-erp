import { requireWorkspace } from "@/core/session";
import { ActivityTypesScreen } from "@/features/crm/activity-types/screens/ActivityTypesScreen";

export const metadata = { title: "Activity types and plans" };

export default async function Page() {
  await requireWorkspace();
  return <ActivityTypesScreen />;
}
