import { Suspense } from "react";

import { AssetsOverviewScreen } from "@/features/assets/register/RegisterListScreens";

export const metadata = { title: "Assets" };
export default function Page() {
  return <Suspense><AssetsOverviewScreen /></Suspense>;
}
