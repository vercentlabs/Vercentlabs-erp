import { Suspense } from "react";

import { ReportScreen } from "@/features/procurement/insights/ReportScreens";

export const metadata = { title: "Purchase Status" };

// Procurement › Inquiries › Purchase Status: every purchase order with what is received, billed and still open (the Purchase Order
// Progress report, filtered in the URL).
export default function Page() {
  return (
    <Suspense>
      <ReportScreen reportKey="purchase-order-progress" />
    </Suspense>
  );
}
