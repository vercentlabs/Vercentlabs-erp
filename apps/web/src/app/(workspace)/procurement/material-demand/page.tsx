import { MaterialDemandsScreen } from "@/features/manufacturing/boms/screens/MaterialDemandsScreen";
import { RequiresApp } from "@/shared/ui/RequiresApp";

export const metadata = { title: "Material Demand" };

// Procurement › Request: the shortages Manufacturing handed over, bought through Procurement's own indents and orders. Only with
// Manufacturing on (Procurement plan Phase 0, bug 11); the sidebar item is hidden without it too.
export default function Page() {
  return (
    <RequiresApp app="manufacturing" appName="Manufacturing" page="Material Demand">
      <MaterialDemandsScreen />
    </RequiresApp>
  );
}
