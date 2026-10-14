import { Suspense } from "react";

import { ProductionEntryListScreen } from "@/features/manufacturing/production/screens/ProductionEntryListScreen";

export const metadata = { title: "Production Entries" };

export default function Page() {
  return <Suspense><ProductionEntryListScreen /></Suspense>;
}
