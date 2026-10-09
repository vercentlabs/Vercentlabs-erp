import { Suspense } from "react";

import { NegativeStockScreen } from "@/features/negative-stock/screens/NegativeStockScreen";

export const metadata = { title: "Negative Stock" };

export default function Page() {
  return (
    <Suspense>
      <NegativeStockScreen />
    </Suspense>
  );
}
