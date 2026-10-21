import { SupplierBillFormScreen } from "@/features/procurement/supplier-bills/screens/SupplierBillFormScreen";

export const metadata = { title: "New supplier bill" };

// ?source=po&purchaseOrderId= a purchase order to bill; ?source=grn&goodsReceiptIds= goods receipts (comma separated); ?source=direct(&supplierId=)
// a direct bill without a PO; none: choose how to create the bill. The source only prefills: the server checks eligibility and access.
export default async function Page({ searchParams }: { searchParams: Promise<{ source?: string; purchaseOrderId?: string; goodsReceiptIds?: string; supplierId?: string }> }) {
  const { source, purchaseOrderId, goodsReceiptIds, supplierId } = await searchParams;
  const kind = source === "direct" ? "direct" : source === "grn" ? "goods_receipt" : source === "po" ? "purchase_order" : undefined;
  return <SupplierBillFormScreen orderId={purchaseOrderId} receiptIds={goodsReceiptIds ? goodsReceiptIds.split(",").filter(Boolean) : undefined} source={kind} supplierId={supplierId} />;
}
