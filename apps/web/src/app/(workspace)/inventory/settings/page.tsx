import { Suspense } from "react";

import { InventorySettingsScreen } from "@/features/inventory-settings/screens/InventorySettingsScreen";

export const metadata = { title: "Inventory settings" };

export default function Page() {
  return (
    <Suspense>
      <InventorySettingsScreen />
    </Suspense>
  );
}
