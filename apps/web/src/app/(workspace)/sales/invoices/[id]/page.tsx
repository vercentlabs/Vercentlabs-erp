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
      <InvoiceDetailScreen invoiceId={id} />
      {/* Reached from the invoice header's E-invoice and E-way bill buttons. */}
      <section id="e-invoice" className="scroll-mt-20"><EInvoicePanel invoiceId={id} /></section>
      {/* The e-way bill from the tax invoice (Sales audit M2): for goods sent without a delivery, or when the business generates it from the invoice. */}
      <section id="e-way-bill" className="scroll-mt-20"><EwayBillPanel sourceType="sales_invoice" sourceId={id} /></section>
      <RecordThreadPanel type="sales.invoice" id={id} />
    </div>
  );
}
