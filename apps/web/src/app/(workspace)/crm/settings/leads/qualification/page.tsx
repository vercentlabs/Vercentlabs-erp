import { requireWorkspace } from "@/core/session";
import { LeadQualificationSettingsScreen } from "@/features/crm/leads/screens/LeadQualificationSettingsScreen";

export const metadata = { title: "Qualification" };

export default async function Page() {
  await requireWorkspace();
  return <LeadQualificationSettingsScreen />;
}
