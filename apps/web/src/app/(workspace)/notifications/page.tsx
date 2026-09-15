import { requireWorkspace } from "@/core/session";
import { NotificationsClient } from "./notifications-client";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireWorkspace();
  return <NotificationsClient />;
}
