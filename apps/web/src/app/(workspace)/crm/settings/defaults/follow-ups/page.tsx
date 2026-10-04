import { requireWorkspace } from "@/core/session";
import { WorkDefaultsScreen } from "@/features/crm/settings/screens/WorkDefaultsScreen";

export const metadata = { title: "Follow-up Defaults" };

export default async function WorkDefaultsPage() {
  await requireWorkspace();
  return <WorkDefaultsScreen section="follow-ups" />;
}
