import { requireWorkspace } from "@/core/session";
import { LeadLifecycleSettingsScreen } from "@/features/crm/settings/lead-lifecycle/screens/LeadLifecycleSettingsScreen";

export const metadata = { title: "Lead Lifecycle Stages" };

export default async function CrmLeadLifecycleSettingsPage() {
  await requireWorkspace();
  return <LeadLifecycleSettingsScreen />;
}
