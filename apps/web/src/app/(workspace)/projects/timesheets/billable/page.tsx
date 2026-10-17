import { Suspense } from "react";

import { BillableHoursScreen } from "@/features/projects/billable/BillingScreens";

export const metadata = { title: "Billable Hours" };

export default function Page() {
  return <Suspense><BillableHoursScreen /></Suspense>;
}
