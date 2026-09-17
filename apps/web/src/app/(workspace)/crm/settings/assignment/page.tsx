import { requireWorkspace } from "@/core/session";
import { AssignmentPoliciesSettingsScreen } from "@/features/crm/settings/lead-assignment-policies/screens/AssignmentPoliciesSettingsScreen";

export const metadata = { title: "Lead Assignment Rules" };

export default async function CrmAssignmentSettingsPage() {
  await requireWorkspace();
  return <AssignmentPoliciesSettingsScreen />;
}
