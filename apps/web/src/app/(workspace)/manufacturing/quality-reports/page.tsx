import { Suspense } from "react";

import { QiReportsScreen } from "@/features/manufacturing/quality/screens/QiReportsScreen";

export const metadata = { title: "Quality Reports" };

export default function Page() {
  return <Suspense><QiReportsScreen /></Suspense>;
}
