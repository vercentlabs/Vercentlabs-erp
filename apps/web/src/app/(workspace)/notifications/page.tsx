import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PlatformFoundationPage
      label="Notifications"
      description="Notification preferences are ported and live (services/api/src/core/notification-preferences.js). The notification center itself (unread/read/deep-link feed) is the next step."
    />
  );
}
