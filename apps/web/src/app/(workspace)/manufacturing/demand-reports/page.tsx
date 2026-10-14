import { Suspense } from "react";

import { DemandReportsScreen } from "@/features/manufacturing/demand/screens/DemandReportsScreen";

export const metadata = { title: "Demand Reports" };

export default function Page() {
  return <Suspense><DemandReportsScreen /></Suspense>;
}
