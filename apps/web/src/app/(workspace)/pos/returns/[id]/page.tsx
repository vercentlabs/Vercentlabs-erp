import { requireWorkspace } from "@/core/session";
import { PosReturnDetailScreen } from "@/features/pos/returns/screens/PosReturnDetailScreen";

export const metadata = { title: "POS Return" };

export default async function PosReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <PosReturnDetailScreen returnId={id} />;
}
