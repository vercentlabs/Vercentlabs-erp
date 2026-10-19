import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { SalesOrderDetailScreen } from "@/features/sales/orders/screens/SalesOrderDetailScreen";

export const metadata = { title: "Sales order" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <SalesOrderDetailScreen orderId={id} />
      <RecordThreadPanel type="sales.order" id={id} />
    </div>
  );
}
