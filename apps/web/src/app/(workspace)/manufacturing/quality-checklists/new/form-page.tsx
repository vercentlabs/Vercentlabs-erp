import { Suspense } from "react";

import { QiTemplateFormScreen } from "@/features/manufacturing/quality/screens/QiTemplateFormScreen";

export const metadata = { title: "New inspection checklist" };

export default function Page() {
  return <Suspense><QiTemplateFormScreen /></Suspense>;
}
