import { Suspense } from "react";

import { EwayBillsScreen } from "@/features/sales/deliveries/screens/EwayBillsScreen";

export const metadata = { title: "E-way bills" };

export default function Page() {
  return <Suspense><EwayBillsScreen /></Suspense>;
}
