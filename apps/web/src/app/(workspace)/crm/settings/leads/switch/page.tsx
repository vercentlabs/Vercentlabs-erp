import { requireWorkspace } from "@/core/session";
import { LeadsSwitchScreen } from "@/features/crm/settings/screens/LeadsSwitchScreen";

export const metadata = { title: "Work with leads" };

export default async function Page() {
  await requireWorkspace();
  return <LeadsSwitchScreen />;
}
