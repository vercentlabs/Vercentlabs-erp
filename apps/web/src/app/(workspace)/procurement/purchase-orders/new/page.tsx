import { PurchaseOrderFormScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrderFormScreen";

export const metadata = { title: "New purchase order" };

// ?supplierId= (Supplier → Create Purchase Order) starts the order for that supplier with its defaults.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierId?: string }> }) {
  const { supplierId } = await searchParams;
  return <PurchaseOrderFormScreen supplierId={supplierId} />;
}
