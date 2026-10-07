import { GoodsReceiptFormScreen } from "@/features/procurement/purchase-orders/screens/GoodsReceiptFormScreen";

export const metadata = { title: "Create goods receipt" };

// ?purchaseOrderId= the confirmed purchase order the goods are received against.
export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string }> }) {
  const { purchaseOrderId: order } = await searchParams;
  return <GoodsReceiptFormScreen orderId={order} />;
}
