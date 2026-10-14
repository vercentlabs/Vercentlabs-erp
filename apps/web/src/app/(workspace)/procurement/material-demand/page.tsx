import { MaterialDemandsScreen } from "@/features/manufacturing/boms/screens/MaterialDemandsScreen";

export const metadata = { title: "Material Demand" };

// Procurement › Planning & Control: the shortages Manufacturing handed over, bought through Procurement's own requisitions and orders.
export default function Page() {
  return <MaterialDemandsScreen />;
}
