import { ProcurementReportScreen, SPEND_REPORTS } from "@/features/procurement/screens/AnalyticsScreens";

export const metadata = { title: "Spend analytics" };

export default function Page() {
  return <ProcurementReportScreen title="Spend analytics" description="Where the money goes, and how well it follows the rules." reports={SPEND_REPORTS} />;
}
