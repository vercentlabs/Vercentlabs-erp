import { PosReportsScreen } from "@/features/pos/reports/screens/PosReportsScreen";
import { REPORT_TABS, tabOf } from "@/features/pos/shared/pos-tabs";

export const metadata = { title: "POS Reports" };

export default async function PosReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <PosReportsScreen tab={tabOf(REPORT_TABS, (await searchParams).tab)} />;
}
