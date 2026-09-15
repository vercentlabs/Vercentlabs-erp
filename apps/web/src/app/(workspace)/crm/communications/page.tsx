import { requireWorkspace } from "@/core/session";
import { CommunicationListScreen } from "@/features/crm/communications/screens/CommunicationListScreen";

export const metadata = { title: "Communications" };

export default async function CommunicationsPage() {
  await requireWorkspace();
  return <CommunicationListScreen />;
}
