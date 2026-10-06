import { SALES_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Sales reports" };

export default function Page() {
  return (
    <SalesReportScreen
      title="Reports"
      description="Where orders stand, what is left to deliver and invoice, and quotations that need a decision. Every row opens its record."
      reports={SALES_REPORTS}
    />
  );
}
