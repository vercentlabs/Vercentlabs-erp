import { Suspense } from "react";

import { VarianceExceptionsScreen } from "@/features/manufacturing/variance/screens/VarianceExceptionsScreen";

export const metadata = { title: "Variance Exceptions" };

export default function Page() {
  return <Suspense><VarianceExceptionsScreen /></Suspense>;
}
