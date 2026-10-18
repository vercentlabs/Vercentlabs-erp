import { requireWorkspace } from "@/core/session";
import { LeadConnectorsScreen } from "@/features/crm/connectors/screens/LeadConnectorsScreen";

export const metadata = { title: "Lead connectors" };

export default async function Page() {
  await requireWorkspace();
  return <LeadConnectorsScreen />;
}
