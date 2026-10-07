import { NewReceivingIssueScreen } from "@/features/procurement/purchase-orders/screens/NewReceivingIssueScreen";

export const metadata = { title: "Report receiving issue" };

// ?purchaseOrderId= a refusal at the dock against the order; ?goodsReceiptId= a rejection after receipt against the goods receipt.
export default async function Page({ searchParams }: { searchParams: Promise<{ purchaseOrderId?: string; goodsReceiptId?: string }> }) {
  const { purchaseOrderId, goodsReceiptId } = await searchParams;
  return <NewReceivingIssueScreen purchaseOrderId={purchaseOrderId} goodsReceiptId={goodsReceiptId} />;
}
