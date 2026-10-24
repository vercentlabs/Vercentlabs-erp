import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { GoodsReceiptDetailScreen } from "@/features/procurement/purchase-orders/screens/ReceivingScreens";

export const metadata = { title: "Goods received" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <GoodsReceiptDetailScreen receiptId={id} />
      <RecordThreadPanel type="procurement.goods_receipt" id={id} />
    </div>
  );
}
