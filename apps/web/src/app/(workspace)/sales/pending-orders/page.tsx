import { Suspense } from "react";

import { PENDING_ORDER_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Pending Orders" };

// Sales › Sell › Pending Orders: the one place for "where is my order" (Sales audit). Every row opens its order.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Pending Orders"
        description="Orders not yet finished: what is still to dispatch, by order or by product, what is ready to bill, and whether dispatches kept the customer's date. Every row opens its order."
        reports={PENDING_ORDER_REPORTS}
      />
    </Suspense>
  );
}
