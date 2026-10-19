import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { PurchaseOrderDetailScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrderDetailScreen";

export const metadata = { title: "Purchase order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <PurchaseOrderDetailScreen orderId={id} />
      <RecordThreadPanel type="procurement.purchase_order" id={id} />
    </div>
  );
}
