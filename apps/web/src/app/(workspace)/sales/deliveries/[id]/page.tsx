import { EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { DeliveryDetailScreen } from "@/features/sales/deliveries/screens/DeliveryDetailScreen";

export const metadata = { title: "Delivery" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <DeliveryDetailScreen deliveryId={id} />
      <EwayBillPanel sourceType="sales_delivery" sourceId={id} />
      <RecordThreadPanel type="sales.delivery" id={id} />
    </div>
  );
}
