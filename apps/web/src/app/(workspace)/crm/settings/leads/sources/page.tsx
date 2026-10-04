import { requireWorkspace } from "@/core/session";
import { LeadSourcesSettingsScreen } from "@/features/crm/leads/screens/LeadSettingsScreens";

export const metadata = { title: "Lead sources" };

export default async function Page() {
  await requireWorkspace();
  return <LeadSourcesSettingsScreen />;
}
