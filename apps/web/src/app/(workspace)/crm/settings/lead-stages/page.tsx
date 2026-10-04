import { requireWorkspace } from "@/core/session";
import { LeadStagesSettingsScreen } from "@/features/crm/leads/screens/LeadStagesSettingsScreen";

export const metadata = { title: "Lead stages" };

export default async function Page() {
  await requireWorkspace();
  return <LeadStagesSettingsScreen />;
}
