import { Suspense } from "react";

import { HoldReportsScreen } from "@/features/manufacturing/holds/screens/HoldReportsScreen";

export const metadata = { title: "Production Hold Reports" };

export default function Page() {
  return <Suspense><HoldReportsScreen /></Suspense>;
}
