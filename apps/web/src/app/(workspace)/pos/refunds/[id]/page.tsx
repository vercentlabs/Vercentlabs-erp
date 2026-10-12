import { requireWorkspace } from "@/core/session";
import { PosRefundDetailScreen } from "@/features/pos/refunds/screens/PosRefundDetailScreen";

export const metadata = { title: "POS Refund" };

export default async function PosRefundPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <PosRefundDetailScreen refundId={id} />;
}
