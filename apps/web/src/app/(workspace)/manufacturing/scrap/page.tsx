import { Suspense } from "react";

import { ScrapListScreen } from "@/features/manufacturing/scrap/screens/ScrapListScreen";

export const metadata = { title: "Scrap" };

export default function Page() {
  return <Suspense><ScrapListScreen /></Suspense>;
}
