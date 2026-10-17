import { Suspense } from "react";

import { LocationDiscrepanciesScreen } from "@/features/assets/locations/LocationScreens";

export const metadata = { title: "Location discrepancies" };
export default function Page() {
  return <Suspense><LocationDiscrepanciesScreen /></Suspense>;
}
