import { EInvoicePanel, EwayBillPanel } from "@/features/platform/compliance/CompliancePanels";
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
      {/* The GST tab holds the e-invoice and the e-way bill from the tax invoice (Sales audit M2: for goods sent without a delivery); the record's
          notes and files are in Notes & files (Sales plan). */}
      <InvoiceDetailScreen invoiceId={id}
        gst={<><EInvoicePanel invoiceId={id} /><EwayBillPanel sourceType="sales_invoice" sourceId={id} /></>}
        thread={<RecordThreadPanel type="sales.invoice" id={id} />} />
    </div>
  );
}
