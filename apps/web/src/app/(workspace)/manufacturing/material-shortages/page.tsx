import { Suspense } from "react";

import { MaterialShortagesScreen } from "@/features/manufacturing/availability/screens/MaterialShortagesScreen";

export const metadata = { title: "Material Shortages" };

export default function Page() {
  return <Suspense><MaterialShortagesScreen /></Suspense>;
}
