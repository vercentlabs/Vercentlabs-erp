import { requireWorkspace } from "@/core/session";
import { PosReportsHubScreen } from "@/features/pos/reports/screens/PosReportsHubScreen";

export const metadata = { title: "POS Reports" };

export default async function PosReportsPage() {
  await requireWorkspace();
  return <PosReportsHubScreen />;
}
