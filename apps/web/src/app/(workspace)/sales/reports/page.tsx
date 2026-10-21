import { Suspense } from "react";

import { SALES_FIGURE_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Sales reports" };

// Sales › Reports. ?report=sales-by-period | sales-by-customer | sales-by-item | pending-approvals | expiring-quotations opens one.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Sales Reports"
        description="Sales by period, customer and item from posted invoices less credit notes, and quotations that need a decision. Where orders stand is in Pending Orders. Every row opens its record."
        reports={SALES_FIGURE_REPORTS}
      />
    </Suspense>
  );
}
