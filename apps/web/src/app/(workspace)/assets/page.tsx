import { Suspense } from "react";

import { AssetsDashboardScreen } from "@/features/assets/overview/OverviewScreens";

export const metadata = { title: "Assets" };
export default function Page() {
  return <Suspense><AssetsDashboardScreen /></Suspense>;
}
