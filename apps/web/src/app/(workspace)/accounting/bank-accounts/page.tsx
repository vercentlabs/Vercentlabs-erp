import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Bank and cash accounts" };

export default function BankAccountsPage() {
  return <AccountingPage name="bank-accounts" />;
}
