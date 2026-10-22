import { CreditNotesScreen } from "@/features/sales/credit-notes/screens/CreditNotesScreen";
import { NotesTabs } from "@/features/sales/debit-notes/DebitNoteScreens";

export const metadata = { title: "Credit notes" };

// Sales › Billing › Credit & Debit Notes (Sales plan): credit notes here, debit notes beside them.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <NotesTabs current="credit" />
      <CreditNotesScreen />
    </div>
  );
}
