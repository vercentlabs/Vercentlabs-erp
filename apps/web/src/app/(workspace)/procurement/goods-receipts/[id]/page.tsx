import { GoodsReceiptDetailScreen } from "@/features/procurement/purchase-orders/screens/ReceivingScreens";

export const metadata = { title: "Goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoodsReceiptDetailScreen receiptId={id} />;
}
