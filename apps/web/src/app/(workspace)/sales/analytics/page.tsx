import { SalesReportScreen, ANALYTICS_REPORTS } from "@/features/sales/reports/screens/SalesInsightScreens";

export const metadata = { title: "Sales analytics" };

export default function Page() {
  return <SalesReportScreen title="Sales analytics" description="How quotations convert, what orders come in, and who buys." reports={ANALYTICS_REPORTS} />;
}
