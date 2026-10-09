import { AdjustmentFormScreen } from "@/features/adjustments/screens/AdjustmentFormScreen";

export const metadata = { title: "Edit Stock Adjustment" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdjustmentFormScreen adjustmentId={id} />;
}
