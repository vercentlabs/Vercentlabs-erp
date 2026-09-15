import { requireWorkspace } from "@/core/session";
import { CrmHomeScreen } from "@/features/crm/home/screens/CrmHomeScreen";

export const metadata = { title: "CRM" };

export default async function CrmPage() {
  await requireWorkspace();
  return <CrmHomeScreen />;
}
