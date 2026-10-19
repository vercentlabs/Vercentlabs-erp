import { EInvoicePanel } from "@/features/platform/compliance/CompliancePanels";
import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { InvoiceDetailScreen } from "@/features/sales/invoices/screens/InvoiceDetailScreen";

export const metadata = { title: "Invoice" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <InvoiceDetailScreen invoiceId={id} />
      <EInvoicePanel invoiceId={id} />
      <RecordThreadPanel type="sales.invoice" id={id} />
    </div>
  );
}
