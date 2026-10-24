import { EInvoicePanel } from "@/features/platform/compliance/CompliancePanels";
import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { DebitNoteDetailScreen } from "@/features/sales/debit-notes/DebitNoteScreens";

export const metadata = { title: "Debit note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <DebitNoteDetailScreen debitNoteId={id} />
      {/* A debit note to a registered customer gets its own IRN (type DBN) under the e-invoice mandate (Sales plan). */}
      <EInvoicePanel invoiceId={id} />
      <RecordThreadPanel type="sales.debit_note" id={id} />
    </div>
  );
}
