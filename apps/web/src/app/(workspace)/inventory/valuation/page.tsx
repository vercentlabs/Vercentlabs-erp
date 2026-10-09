import { Suspense } from "react";

import { ValuationScreen } from "@/features/valuation/screens/ValuationScreen";

export const metadata = { title: "Inventory Valuation" };

export default function Page() {
  return (
    <Suspense>
      <ValuationScreen />
    </Suspense>
  );
}
