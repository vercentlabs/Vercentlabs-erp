import { GoodsReceiptFormScreen } from "@/features/procurement/purchase-orders/screens/GoodsReceiptFormScreen";

export const metadata = { title: "Edit goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoodsReceiptFormScreen receiptId={id} />;
}
