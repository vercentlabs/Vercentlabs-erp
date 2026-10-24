import { EInvoicePanel } from "@/features/platform/compliance/CompliancePanels";
import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { CustomerConversationPanel } from "@/features/sales/shared/CustomerConversationPanel";
import { CreditNoteDetailScreen } from "@/features/sales/credit-notes/screens/CreditNoteDetailScreen";

export const metadata = { title: "Credit note" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <CreditNoteDetailScreen creditNoteId={id} />
      {/* A credit note to a registered customer gets its own IRN (type CRN) under the e-invoice mandate (Sales audit B9). */}
      <EInvoicePanel invoiceId={id} />
      <CustomerConversationPanel type="sales.credit_note" id={id} />
      <RecordThreadPanel type="sales.credit_note" id={id} />
    </div>
  );
}
