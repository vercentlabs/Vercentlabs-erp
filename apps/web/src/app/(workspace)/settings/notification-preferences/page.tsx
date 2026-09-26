import { requireWorkspace } from "@/core/session";
import { NotificationPreferencesScreen } from "@/features/settings/notification-preferences/screens/NotificationPreferencesScreen";

export const metadata = { title: "Notification preferences" };

export default async function NotificationPreferencesPage() {
  await requireWorkspace();
  return <NotificationPreferencesScreen />;
}
