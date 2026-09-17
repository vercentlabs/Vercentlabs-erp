import { requireWorkspace } from "@/core/session";
import { MeetingLinksSettingsScreen } from "@/features/crm/settings/meeting-links/screens/MeetingLinksSettingsScreen";

export const metadata = { title: "Meeting Links" };

export default async function MeetingLinksSettingsPage() {
  await requireWorkspace();
  return <MeetingLinksSettingsScreen />;
}
