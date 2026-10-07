import { PurchaseOrderDetailScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrderDetailScreen";

export const metadata = { title: "Purchase order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PurchaseOrderDetailScreen orderId={id} />;
}
