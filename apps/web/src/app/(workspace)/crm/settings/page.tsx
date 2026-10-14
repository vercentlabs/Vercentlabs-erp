import { requireWorkspace } from "@/core/session";
import { CrmSetupScreen } from "@/features/crm/settings/screens/CrmSetupScreen";

export const metadata = { title: "Setup" };

// CRM › Setup: every CRM setting on one page, in set-up order.
export default async function Page() {
  await requireWorkspace();
  return <CrmSetupScreen />;
}
