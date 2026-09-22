"use client";

import { REGISTERS } from "@/features/inventory/configs";
import { GenerateVariantsPanel, InventoryReportsScreen, InventorySettingsScreen, ScanLookup } from "@/features/inventory/screens/InventoryScreens";
import { GenealogyScreen, QuarantineScreen } from "@/features/inventory/screens/TraceScreens";
import { Register } from "@/features/inventory/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never
// config objects, because those hold functions that cannot cross the server/client boundary.
export function InventoryPage({ name }: { name: string }) {
  if (name === "genealogy") return <GenealogyScreen />;
  if (name === "quarantine") return <QuarantineScreen />;
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
  if (name === "variants") {
    return (
      <div className="flex flex-col gap-4">
        <GenerateVariantsPanel />
        <Register config={config} />
      </div>
    );
  }
  return <Register config={config} />;
}
