import { requireWorkspace } from "@/core/session";
import { CallListScreen } from "@/features/crm/calls/screens/CallListScreen";

export const metadata = { title: "Calls" };

export default async function CallsPage() {
  await requireWorkspace();
  return <CallListScreen />;
}
