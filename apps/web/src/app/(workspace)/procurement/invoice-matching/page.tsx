import { Suspense } from "react";

import { InvoiceMatchingScreen } from "@/features/procurement/insights/InvoiceMatchingScreen";

export const metadata = { title: "Invoice Matching" };

export default function Page() {
  return (
    <Suspense>
      <InvoiceMatchingScreen />
    </Suspense>
  );
}
