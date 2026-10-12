import { PaymentExceptionsTab } from "@/features/pos/transactions/components/PaymentExceptionsTab";
import { PosTransactionsScreen } from "@/features/pos/transactions/screens/PosTransactionsScreen";
import { PosInvoicesScreen } from "@/features/pos/invoices/screens/PosInvoicesScreen";
import { tabOf } from "@/features/pos/shared/pos-tabs";
import { PosTabs } from "@/features/pos/shared/PosTabs";

export const metadata = { title: "POS Transactions" };

const TABS = [{ id: "sales", label: "Sales" }, { id: "payments", label: "Payments" }, { id: "documents", label: "Documents", anyPermission: ["pos.invoice.view", "pos.invoice.generate"] }];

// POS › Transactions: what happened in a sale (?tab=sales), payments that need a decision (?tab=payments), and the receipts, GST invoices,
// bills of supply and credit notes issued (?tab=documents). A sale keeps its own address (/pos/transactions/<id>).
export default async function PosTransactionsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = tabOf(TABS, (await searchParams).tab);
  return (
    <div className="flex flex-col gap-4">
      <PosTabs label="Transactions" base="/pos/transactions" tabs={TABS} current={tab} />
      {tab === "payments" ? <PaymentExceptionsTab /> : tab === "documents" ? <PosInvoicesScreen /> : <PosTransactionsScreen />}
    </div>
  );
}
