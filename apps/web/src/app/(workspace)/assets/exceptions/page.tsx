import { Suspense } from "react";

import { AssetsControlCenterScreen } from "@/features/assets/overview/OverviewScreens";

export const metadata = { title: "Assets exceptions & reconciliation" };
export default function Page() {
  return <Suspense><AssetsControlCenterScreen /></Suspense>;
}
