import { Suspense } from "react";

import { StockCountsScreen } from "@/features/stock-counts/screens/StockCountsScreen";

export const metadata = { title: "Stock Counts" };

export default function Page() {
  return (
    <Suspense>
      <StockCountsScreen />
    </Suspense>
  );
}
