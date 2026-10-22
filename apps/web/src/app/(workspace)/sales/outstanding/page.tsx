import { Suspense } from "react";

import { CustomerOutstandingScreen } from "@/features/sales/customers/screens/CustomerOutstandingScreen";

export const metadata = { title: "Outstanding" };

// ?tab=statements opens Customer statements (&customer= one customer).
export default function Page() {
  return <Suspense><CustomerOutstandingScreen /></Suspense>;
}
