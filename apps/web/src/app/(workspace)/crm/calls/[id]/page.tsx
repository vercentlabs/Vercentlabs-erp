import { requireWorkspace } from "@/core/session";
import { CallDetailScreen } from "@/features/crm/calls/screens/CallDetailScreen";

export const metadata = { title: "Call" };

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <CallDetailScreen callId={id} />;
}
