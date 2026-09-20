"use client";

import { REGISTERS } from "@/features/manufacturing/configs";
import { CapacityScreen } from "@/features/manufacturing/screens/RoutingScreens";
import { WhereUsedScreen } from "@/features/manufacturing/screens/WhereUsedScreen";
import { Register } from "@/features/manufacturing/shared/Register";

// Resolves a page name (from the URL) to its screen. Server pages pass only the name, never config
// objects, because those hold functions that cannot cross the server/client boundary.
export function ManufacturingPage({ name }: { name: string }) {
  if (name === "capacity") return <CapacityScreen />;
  if (name === "where-used") return <WhereUsedScreen />;
  const config = REGISTERS[name];
  if (!config) return null;
  return <Register config={config} />;
}
