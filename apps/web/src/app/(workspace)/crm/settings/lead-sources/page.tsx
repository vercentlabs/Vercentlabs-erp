import { requireWorkspace } from "@/core/session";
import { LeadSourcesSettingsScreen } from "@/features/crm/settings/lead-sources/screens/LeadSourcesSettingsScreen";

export const metadata = { title: "Lead Sources" };

export default async function LeadSourcesSettingsPage() {
  await requireWorkspace();
  return <LeadSourcesSettingsScreen />;
}
