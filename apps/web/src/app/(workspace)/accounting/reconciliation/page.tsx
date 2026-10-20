import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Bank reconciliation" };

export default function ReconciliationPage() {
  return <AccountingPage name="reconciliation" />;
}
