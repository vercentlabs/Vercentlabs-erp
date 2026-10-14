import { Suspense } from "react";

import { QiTemplatesScreen } from "@/features/manufacturing/quality/screens/QiTemplatesScreen";

export const metadata = { title: "Inspection Checklists" };

export default function Page() {
  return <Suspense><QiTemplatesScreen /></Suspense>;
}
