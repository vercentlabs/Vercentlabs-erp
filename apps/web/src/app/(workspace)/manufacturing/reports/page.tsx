import { Suspense } from "react";

import { ProductionReportsScreen } from "@/features/manufacturing/orders/screens/ProductionReportsScreen";

export const metadata = { title: "Manufacturing reports" };

export default function Page() {
  return <Suspense><ProductionReportsScreen /></Suspense>;
}
