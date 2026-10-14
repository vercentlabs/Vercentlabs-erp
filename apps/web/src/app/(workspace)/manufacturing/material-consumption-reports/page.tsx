import { Suspense } from "react";

import { MaterialConsumptionReportsScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionReportsScreen";

export const metadata = { title: "Material Consumption Reports" };

export default function Page() {
  return <Suspense><MaterialConsumptionReportsScreen /></Suspense>;
}
