import { SalesReportScreen, STATUS_REPORTS } from "@/features/sales/reports/screens/SalesInsightScreens";

export const metadata = { title: "Order status" };

export default function Page() {
  return <SalesReportScreen title="Order status" description="Where every open order and quotation stands." reports={STATUS_REPORTS} />;
}
