import { requireWorkspace } from "@/core/session";
import { LeadAssignmentSettingsScreen } from "@/features/crm/leads/screens/LeadAssignmentSettingsScreen";

export const metadata = { title: "Assignment" };

export default async function Page() {
  await requireWorkspace();
  return <LeadAssignmentSettingsScreen />;
}
