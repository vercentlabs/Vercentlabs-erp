import { Suspense } from "react";

import { MaterialConsumptionListScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionListScreen";

export const metadata = { title: "Material Consumption" };

export default function Page() {
  return <Suspense><MaterialConsumptionListScreen /></Suspense>;
}
