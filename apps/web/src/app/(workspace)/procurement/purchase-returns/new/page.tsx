import { PurchaseReturnFormScreen } from "@/features/procurement/purchase-returns/screens/PurchaseReturnFormScreen";

export const metadata = { title: "New purchase return" };

// ?purchaseOrderId= a purchase order's received goods; ?goodsReceiptId= one goods receipt's; neither: choose the order.
export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string; goodsReceiptId?: string }> }) {
  const { purchaseOrderId: order, goodsReceiptId: receipt } = await searchParams;
  return <PurchaseReturnFormScreen orderId={order} receiptId={receipt} />;
}
