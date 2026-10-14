import { Suspense } from "react";

import { CostingReportsScreen } from "@/features/manufacturing/costing/screens/CostingReportsScreen";

export const metadata = { title: "Production Costing Reports" };

export default function Page() {
  return <Suspense><CostingReportsScreen /></Suspense>;
}
