import { EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
import { ChallanDetailScreen } from "@/features/sales/challans/ChallanDetailScreen";

export const metadata = { title: "Delivery Challan" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <ChallanDetailScreen challanId={id} />
      <EwayBillPanel sourceType="sales_challan" sourceId={id} />
    </div>
  );
}
