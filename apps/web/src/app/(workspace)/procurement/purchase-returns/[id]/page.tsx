import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
import { PurchaseReturnDetailScreen } from "@/features/procurement/purchase-returns/screens/PurchaseReturnScreens";

export const metadata = { title: "Return to supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <PurchaseReturnDetailScreen returnId={id} />
      <EwayBillPanel sourceType="purchase_return" sourceId={id} />
      <RecordThreadPanel type="procurement.purchase_return" id={id} />
    </div>
  );
}
