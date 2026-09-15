import { requireWorkspace } from "@/core/session";
import { MeetingListScreen } from "@/features/crm/meetings/screens/MeetingListScreen";

export const metadata = { title: "Meetings" };

export default async function MeetingsPage() {
  await requireWorkspace();
  return <MeetingListScreen />;
}
