import { Suspense } from "react";

import { MovementHistoryScreen } from "@/features/movement-history/screens/MovementHistoryScreen";
import { StockLedgerScreen } from "@/features/stock-ledger/screens/StockLedgerScreen";
import { RouteTabs } from "@/shared/ui/RouteTabs";

export const metadata = { title: "Inventory Transactions" };

const TABS = [{ id: "movements", label: "Movement History" }, { id: "ledger", label: "Ledger Entries" }] as const;

// Inventory › Inquiries › Inventory Transactions: what moved (Movement History: business events, per item) and the ledger lines behind it
// (Ledger Entries), one tab each (?tab=movements | ledger); every other parameter is the tab's own filter. Each tab is the existing screen.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const current = tab === "ledger" ? "ledger" : "movements";
  return (
    <div className="flex flex-col gap-4">
      <RouteTabs label="Inventory transactions" base="/inventory/transactions" tabs={TABS} current={current} />
      <Suspense>{current === "ledger" ? <StockLedgerScreen /> : <MovementHistoryScreen />}</Suspense>
    </div>
  );
}
