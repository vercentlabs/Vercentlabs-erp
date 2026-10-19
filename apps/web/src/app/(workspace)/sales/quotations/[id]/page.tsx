import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { SalesQuotationDetailScreen } from "@/features/sales/quotations/screens/SalesQuotationDetailScreen";

export const metadata = { title: "Quotation" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <SalesQuotationDetailScreen quotationId={id} />
      <RecordThreadPanel type="sales.quotation" id={id} />
    </div>
  );
}
