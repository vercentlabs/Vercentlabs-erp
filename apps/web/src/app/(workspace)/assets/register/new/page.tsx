import { Suspense } from "react";

import { NewAssetScreen } from "@/features/assets/register/AssetFormScreens";

export const metadata = { title: "Add an asset" };
export default function Page() {
  return <Suspense><NewAssetScreen /></Suspense>;
}
