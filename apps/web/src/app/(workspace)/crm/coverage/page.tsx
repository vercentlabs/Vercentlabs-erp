import { requireWorkspace } from "@/core/session";
import { SalesCoverageScreen } from "@/features/crm/coverage/screens/SalesCoverageScreen";

export const metadata = { title: "Sales Coverage" };

export default async function SalesCoveragePage() {
  await requireWorkspace();
  return <SalesCoverageScreen />;
}
