import { Suspense } from "react";

import { RegisterFromPurchaseScreen } from "@/features/assets/register/AssetFormScreens";

export const metadata = { title: "Register from purchase" };
export default function Page() {
  return <Suspense><RegisterFromPurchaseScreen /></Suspense>;
}
