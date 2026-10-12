import { AccountLedgerScreen } from "@/features/accounting/automatic/screens/AccountLedgerScreen";

export const metadata = { title: "Account ledger" };

export default async function AccountLedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <AccountLedgerScreen accountId={accountId} />;
}
