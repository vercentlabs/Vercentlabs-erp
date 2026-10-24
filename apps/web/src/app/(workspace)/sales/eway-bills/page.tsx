import { Suspense } from "react";

import { EwayBillsScreen } from "@/features/sales/deliveries/screens/EwayBillsScreen";
import { EDocumentsTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "E-way bills" };

// Sales › Deliver › E-invoices & E-way Bills › E-way bills made.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <EDocumentsTabs current="eway" />
      <Suspense><EwayBillsScreen /></Suspense>
    </div>
  );
}
