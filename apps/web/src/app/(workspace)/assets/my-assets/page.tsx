import { Suspense } from "react";

import { MyAssetsScreen } from "@/features/assets/custody/CustodyScreens";

export const metadata = { title: "My assets" };
export default function Page() {
  return <Suspense><MyAssetsScreen /></Suspense>;
}
