import { requireWorkspace } from "@/core/session";
import { CrmSetupScreen } from "@/features/crm/settings/screens/CrmSetupScreen";

export const metadata = { title: "Setup" };

// The former Lead Setup / Opportunity Setup hubs: their address opens the one CRM Setup page.
export default async function Page() {
  await requireWorkspace();
  return <CrmSetupScreen />;
}
