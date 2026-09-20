"use client";

import { REGISTERS } from "@/features/inventory/configs";
import { InventoryReportsScreen, InventorySettingsScreen, ScanLookup } from "@/features/inventory/screens/InventoryScreens";
import { Register } from "@/features/inventory/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never
// config objects, because those hold functions that cannot cross the server/client boundary.
export function InventoryPage({ name }: { name: string }) {
  if (name === "reports") return <InventoryReportsScreen />;
  if (name === "costing") return <InventorySettingsScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  if (name === "availability") {
    return (
      <div className="flex flex-col gap-4">
        <ScanLookup />
        <Register config={config} />
      </div>
    );
  }
  return <Register config={config} />;
}
