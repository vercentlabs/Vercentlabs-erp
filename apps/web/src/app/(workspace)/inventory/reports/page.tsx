import { Suspense } from "react";

import { InventoryReportsScreen } from "@/features/inventory-reports/screens/InventoryReportsScreen";

export const metadata = { title: "Inventory Reports" };

export default function Page() {
  return (
    <Suspense>
      <InventoryReportsScreen />
    </Suspense>
  );
}
