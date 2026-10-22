import { Suspense } from "react";

import { PaymentFormScreen } from "@/features/sales/payments/PaymentFormScreen";

export const metadata = { title: "Payment received" };

// ?customerId= (and ?amount=) start the form for a customer, as Outstanding's Record payment does.
export default function Page() {
  return <Suspense><PaymentFormScreen /></Suspense>;
}
