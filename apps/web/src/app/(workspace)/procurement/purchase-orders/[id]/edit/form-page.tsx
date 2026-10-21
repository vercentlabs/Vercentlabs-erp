import { PurchaseOrderFormScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrderFormScreen";

export const metadata = { title: "Edit purchase order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderFormScreen orderId={id} />;
}
