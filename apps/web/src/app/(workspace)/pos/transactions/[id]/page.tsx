import { requireWorkspace } from "@/core/session";
import { PosTransactionDetailScreen } from "@/features/pos/transactions/screens/PosTransactionDetailScreen";

export const metadata = { title: "POS Transaction" };

export default async function PosTransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <PosTransactionDetailScreen saleId={id} />;
}
