import { requireWorkspace } from "@/core/session";
import { LeadAssignmentRulesScreen } from "@/features/crm/leads/screens/LeadSettingsScreens";

export const metadata = { title: "Lead assignment rules" };

export default async function Page() {
  await requireWorkspace();
  return <LeadAssignmentRulesScreen />;
}
