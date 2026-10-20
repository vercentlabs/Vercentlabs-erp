import { Suspense } from "react";

import { AccountLedgerScreen } from "@/features/accounting/journals/screens/AccountLedgerScreen";

export const metadata = { title: "Account ledger" };

// Suspense: the screen reads its dates and department / cost centre from the URL (opened from the General Ledger).
export default async function AccountLedgerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <Suspense><AccountLedgerScreen accountId={accountId} /></Suspense>;
}
