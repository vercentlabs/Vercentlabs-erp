import { Suspense } from "react";

import { CostRatesScreen } from "@/features/manufacturing/costing/screens/CostRatesScreen";

export const metadata = { title: "Production Costing" };

export default function Page() {
  return <Suspense><CostRatesScreen /></Suspense>;
}
