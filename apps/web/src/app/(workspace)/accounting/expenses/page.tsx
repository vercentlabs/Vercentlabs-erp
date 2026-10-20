import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Expenses" };

export default function ExpensesPage() {
  return <AccountingPage name="expenses" />;
}
