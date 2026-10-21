import { Suspense } from "react";

import { PaymentFormScreen } from "@/features/accounting/payables/screens/PaymentFormScreen";

export const metadata = { title: "Pay supplier" };

// Suspense: the form reads the supplier and bill to prefill from the URL ("Pay" on a bill).
export default function NewPaymentPage() {
  return <Suspense><PaymentFormScreen /></Suspense>;
}
