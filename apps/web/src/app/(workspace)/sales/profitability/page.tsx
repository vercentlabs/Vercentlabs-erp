import { SalesReportScreen, PROFITABILITY_REPORTS } from "@/features/sales/reports/screens/SalesInsightScreens";

export const metadata = { title: "Profitability" };

export default function Page() {
  return <SalesReportScreen title="Profitability" description="Margin by order." reports={PROFITABILITY_REPORTS} />;
}
