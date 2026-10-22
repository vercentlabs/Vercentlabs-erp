import { Suspense } from "react";

import { SALES_REPORT_TABS, SalesReportsPage } from "@/features/sales/reports/screens/SalesReportScreen";

export const metadata = { title: "Sales reports" };

// Sales › Reports (Sales plan): one page. ?tab=sales|orders|quotations|gst|collections|schemes and ?report= open one; an old ?report= link
// finds its tab.
export default function Page() {
  return (
    <Suspense>
      <SalesReportsPage tabs={SALES_REPORT_TABS} />
    </Suspense>
  );
}
