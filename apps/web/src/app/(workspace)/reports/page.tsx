import { requireWorkspace } from "@/core/session";
import { ReportsScreen } from "@/features/platform/reports/ReportsScreen";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requireWorkspace();
  return <ReportsScreen />;
}
