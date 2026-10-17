import { Suspense } from "react";

import { AssetReportsScreen } from "@/features/assets/register/AssetFormScreens";

export const metadata = { title: "Asset reports" };
export default function Page() {
  return <Suspense><AssetReportsScreen /></Suspense>;
}
