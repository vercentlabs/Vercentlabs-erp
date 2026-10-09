import { Suspense } from "react";

import { SALES_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Sales reports" };

// Sales › Reports. ?report=sales-by-period | sales-by-customer | sales-by-item | order-status | … opens one.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Sales Reports"
        description="Sales by period, customer and item from posted invoices less credit notes; where orders stand, what is left to deliver and invoice, and quotations that need a decision. Every row opens its record."
        reports={SALES_REPORTS}
      />
    </Suspense>
  );
}
