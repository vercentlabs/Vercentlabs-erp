import { requireWorkspace } from "@/core/session";
import { NotificationsScreen } from "@/features/platform/notifications/NotificationsScreen";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireWorkspace();
  return <NotificationsScreen />;
}
