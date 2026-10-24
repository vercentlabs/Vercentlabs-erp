import { CreditNotesScreen } from "@/features/sales/credit-notes/screens/CreditNotesScreen";
import { NotesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Credit notes" };

// Sales › Bill › Credit & Debit Notes: credit notes here, debit notes beside them.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <NotesTabs current="credit" />
      <CreditNotesScreen />
    </div>
  );
}
