import { requireWorkspace } from "@/core/session";
import { FollowUpDetailScreen } from "@/features/crm/follow-ups/screens/FollowUpDetailScreen";

export const metadata = { title: "Follow-up" };

export default async function FollowUpDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <FollowUpDetailScreen followUpId={id} />;
}
