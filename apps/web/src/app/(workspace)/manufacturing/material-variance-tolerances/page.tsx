import { Suspense } from "react";

import { VarianceTolerancesScreen } from "@/features/manufacturing/variance/screens/VarianceTolerancesScreen";

export const metadata = { title: "Variance Tolerances" };

export default function Page() {
  return <Suspense><VarianceTolerancesScreen /></Suspense>;
}
