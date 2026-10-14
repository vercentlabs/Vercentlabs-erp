import { Suspense } from "react";

import { MaterialReportsScreen } from "@/features/manufacturing/availability/screens/MaterialReportsScreen";

export const metadata = { title: "Material Availability Reports" };

export default function Page() {
  return <Suspense><MaterialReportsScreen /></Suspense>;
}
