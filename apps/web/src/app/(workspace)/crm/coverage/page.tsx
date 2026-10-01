import { requireWorkspace } from "@/core/session";
import { SalesCoverageScreen } from "@/features/crm/pipeline/coverage/screens/SalesCoverageScreen";

export const metadata = { title: "Sales Coverage" };

export default async function SalesCoveragePage() {
  await requireWorkspace();
  return <SalesCoverageScreen />;
}
