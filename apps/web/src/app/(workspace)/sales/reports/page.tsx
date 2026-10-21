import { Suspense } from "react";

import { PENDING_ORDER_REPORTS, SALES_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Sales reports" };

// Where orders stand lives in Pending Orders (Sales audit); the reports are the sales figures and the quotations waiting on someone.
const REPORTS = SALES_REPORTS.filter((report) => !PENDING_ORDER_REPORTS.some((pending) => pending.key === report.key));

// Sales › Reports. ?report=sales-by-period | sales-by-customer | sales-by-item | pending-approvals | expiring-quotations opens one.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Sales Reports"
        description="Sales by period, customer and item from posted invoices less credit notes, and quotations that need a decision. Where orders stand is in Pending Orders. Every row opens its record."
        reports={REPORTS}
      />
    </Suspense>
  );
}
