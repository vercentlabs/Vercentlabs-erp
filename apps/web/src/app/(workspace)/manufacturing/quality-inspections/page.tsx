import { Suspense } from "react";

import { QiListScreen } from "@/features/manufacturing/quality/screens/QiListScreen";

export const metadata = { title: "Production Inspections" };

export default function Page() {
  return <Suspense><QiListScreen /></Suspense>;
}
