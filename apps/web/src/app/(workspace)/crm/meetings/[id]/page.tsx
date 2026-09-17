import { requireWorkspace } from "@/core/session";
import { MeetingDetailScreen } from "@/features/crm/meetings/screens/MeetingDetailScreen";

export const metadata = { title: "Meeting" };

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <MeetingDetailScreen meetingId={id} />;
}
