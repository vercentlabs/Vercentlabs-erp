import { Suspense } from "react";

import { StockBalanceScreen } from "@/features/stock-balance/screens/StockBalanceScreen";

export const metadata = { title: "On-Hand Inventory" };

export default function Page() {
  return (
    <Suspense>
      <StockBalanceScreen />
    </Suspense>
  );
}
