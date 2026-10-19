import { EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
import { TransferDetailScreen } from "@/features/transfers/screens/TransferDetailScreen";

export const metadata = { title: "Transfer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <TransferDetailScreen transferId={id} />
      <EwayBillPanel sourceType="stock_transfer" sourceId={id} />
    </div>
  );
}
