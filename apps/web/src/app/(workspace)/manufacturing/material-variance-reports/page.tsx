import { Suspense } from "react";

import { VarianceReportsScreen } from "@/features/manufacturing/variance/screens/VarianceReportsScreen";

export const metadata = { title: "Material Usage Variance" };

export default function Page() {
  return <Suspense><VarianceReportsScreen /></Suspense>;
}
