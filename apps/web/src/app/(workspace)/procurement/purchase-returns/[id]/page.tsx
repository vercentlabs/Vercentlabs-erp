import { EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
import { PurchaseReturnDetailScreen } from "@/features/procurement/purchase-returns/screens/PurchaseReturnScreens";

export const metadata = { title: "Purchase return" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <PurchaseReturnDetailScreen returnId={id} />
      <EwayBillPanel sourceType="purchase_return" sourceId={id} />
    </div>
  );
}
