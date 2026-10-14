import { Suspense } from "react";

import { ProductionProgressReportsScreen } from "@/features/manufacturing/production/screens/ProductionProgressReportsScreen";

export const metadata = { title: "Production Progress" };

export default function Page() {
  return <Suspense><ProductionProgressReportsScreen /></Suspense>;
}
