import { Suspense } from "react";

import { InvoiceMatchingScreen } from "@/features/procurement/insights/InvoiceMatchingScreen";

export const metadata = { title: "Bill matching" };

export default function Page() {
  return (
    <Suspense>
      <InvoiceMatchingScreen />
    </Suspense>
  );
}
