import { Suspense } from "react";

import { ReceiptFormScreen } from "@/features/accounting/receivables/screens/ReceiptFormScreen";

export const metadata = { title: "Record payment" };

// Suspense: the form reads the customer and invoice to prefill from the URL ("Record payment" on an invoice).
export default function NewReceiptPage() {
  return <Suspense><ReceiptFormScreen /></Suspense>;
}
