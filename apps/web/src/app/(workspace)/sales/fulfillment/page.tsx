import { Suspense } from "react";

import { FULFILLMENT_REPORTS, SalesReportScreen } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Order Fulfillment" };

// Sales › Planning & Control › Order Fulfillment: what confirmed orders still need delivered and invoiced. Deliveries and invoices are
// created from the order; every row opens it.
export default function Page() {
  return (
    <Suspense>
      <SalesReportScreen
        title="Order Fulfillment"
        description="Confirmed orders with goods still to deliver, open demand per product, delivery performance and what is ready to invoice. Every row opens its order."
        reports={FULFILLMENT_REPORTS}
      />
    </Suspense>
  );
}
