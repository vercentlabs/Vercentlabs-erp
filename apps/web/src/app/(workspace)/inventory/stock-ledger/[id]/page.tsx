import { MovementDetailScreen } from "@/features/stock-ledger/screens/MovementDetailScreen";

export const metadata = { title: "Stock Movement" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MovementDetailScreen movementId={id} />;
}
