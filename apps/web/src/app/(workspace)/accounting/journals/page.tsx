import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Journal entries" };

export default function JournalsPage() {
  return <AccountingPage name="journals" />;
}
