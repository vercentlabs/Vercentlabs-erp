import { Suspense } from "react";

import { ProductionActivityScreen } from "@/features/manufacturing/orders/screens/ProductionActivityScreen";

export const metadata = { title: "Production Activity" };

export default function Page() {
  return <Suspense><ProductionActivityScreen /></Suspense>;
}
