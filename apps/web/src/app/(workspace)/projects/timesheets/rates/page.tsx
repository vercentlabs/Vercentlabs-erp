import { Suspense } from "react";

import { LaborRatesScreen } from "@/features/projects/timesheets/TeamScreens";

export const metadata = { title: "Labor Rates" };

export default function Page() {
  return <Suspense><LaborRatesScreen /></Suspense>;
}
