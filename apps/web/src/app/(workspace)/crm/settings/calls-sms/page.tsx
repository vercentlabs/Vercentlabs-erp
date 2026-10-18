import { requireWorkspace } from "@/core/session";
import { CallsSmsSettingsScreen } from "@/features/crm/channels/screens/CallsSmsSettingsScreen";

export const metadata = { title: "Calls and SMS" };

export default async function Page() {
  await requireWorkspace();
  return <CallsSmsSettingsScreen />;
}
