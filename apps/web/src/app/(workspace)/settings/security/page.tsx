import { requireWorkspace } from "@/core/session";
import { SecuritySettingsScreen } from "@/features/settings/security/screens/SecuritySettingsScreen";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  await requireWorkspace();
  return <SecuritySettingsScreen />;
}
