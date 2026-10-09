import { Suspense } from "react";

import { ORDER_STATUS_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Order Status" };

// Sales › Inquiries › Order Status: where every confirmed or closed order stands — reservation, fulfillment, invoicing and payment.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Order Status"
        description="Each order with reservation, fulfillment, invoicing and payment on their own, and what needs attention. Select an order to open it."
        reports={ORDER_STATUS_REPORTS}
      />
    </Suspense>
  );
}
