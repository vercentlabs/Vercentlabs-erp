import { AdjustmentDetailScreen } from "@/features/adjustments/screens/AdjustmentDetailScreen";

export const metadata = { title: "Stock Adjustment" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdjustmentDetailScreen adjustmentId={id} />;
}
