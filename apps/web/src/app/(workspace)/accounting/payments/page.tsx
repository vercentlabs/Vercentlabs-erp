import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Supplier payments" };

export default function PaymentsPage() {
  return <AccountingPage name="payments" />;
}
