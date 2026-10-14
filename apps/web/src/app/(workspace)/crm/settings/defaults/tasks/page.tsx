import { requireWorkspace } from "@/core/session";
import { WorkDefaultsScreen } from "@/features/crm/settings/screens/WorkDefaultsScreen";

export const metadata = { title: "Task and follow-up defaults" };

export default async function WorkDefaultsPage() {
  await requireWorkspace();
  return <WorkDefaultsScreen section="tasks" />;
}
