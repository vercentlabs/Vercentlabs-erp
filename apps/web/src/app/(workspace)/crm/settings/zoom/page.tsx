import { requireWorkspace } from "@/core/session";
import { ZoomSettingsScreen } from "@/features/crm/settings/screens/ZoomSettingsScreen";

export const metadata = { title: "Zoom" };

export default async function Page() {
  await requireWorkspace();
  return <ZoomSettingsScreen />;
}
