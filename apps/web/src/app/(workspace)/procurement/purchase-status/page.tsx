import { Suspense } from "react";

import { ReportScreen } from "@/features/procurement/insights/ReportScreens";
import { OrderTabs } from "@/features/procurement/shared/OrderTabs";

export const metadata = { title: "Order progress" };

// Procurement › Purchase Orders › Progress: every order with what is received, billed and still open (the Purchase Order Progress
// report, filtered in the URL).
export default function Page() {
  return (
    <Suspense>
      <ReportScreen reportKey="purchase-order-progress" tabs={<OrderTabs current="progress" />} />
    </Suspense>
  );
}
