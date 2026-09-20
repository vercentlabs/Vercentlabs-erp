import { SalesReportScreen, ALL_REPORTS } from "@/features/sales/reports/screens/SalesInsightScreens";

export const metadata = { title: "Sales reports" };

export default function Page() {
  return <SalesReportScreen title="Sales reports" description="Order-to-cash, conversion, status and performance in one place." reports={ALL_REPORTS} />;
}
