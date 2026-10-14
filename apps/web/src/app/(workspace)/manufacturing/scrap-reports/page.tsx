import { Suspense } from "react";

import { ScrapReportsScreen } from "@/features/manufacturing/scrap/screens/ScrapReportsScreen";

export const metadata = { title: "Scrap Reports" };

export default function Page() {
  return <Suspense><ScrapReportsScreen /></Suspense>;
}
