import { PurchaseOrderFormScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrderFormScreen";

export const metadata = { title: "New purchase order" };

// ?supplierId= (Supplier → Create Purchase Order) starts the order for that supplier with its defaults; ?copyFrom= (+ New › Copy previous)
// starts from an earlier order's supplier, terms and lines.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierId?: string; copyFrom?: string }> }) {
  const { supplierId, copyFrom } = await searchParams;
  return <PurchaseOrderFormScreen supplierId={supplierId} copyFromId={copyFrom} />;
}
