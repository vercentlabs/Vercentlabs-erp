import { ALL_PROCUREMENT_REPORTS, ProcurementReportScreen } from "@/features/procurement/screens/AnalyticsScreens";

export const metadata = { title: "Procurement reports" };

export default function Page() {
  return <ProcurementReportScreen title="Procurement reports" description="Spend, commitments, delivery, matching and supplier risk." reports={ALL_PROCUREMENT_REPORTS} />;
}
