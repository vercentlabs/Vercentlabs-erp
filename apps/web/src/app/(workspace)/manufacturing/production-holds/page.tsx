import { Suspense } from "react";

import { HoldListScreen } from "@/features/manufacturing/holds/screens/HoldListScreen";

export const metadata = { title: "Production Holds" };

export default function Page() {
  return <Suspense><HoldListScreen /></Suspense>;
}
