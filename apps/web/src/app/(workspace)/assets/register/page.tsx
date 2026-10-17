import { Suspense } from "react";

import { AssetRegisterScreen } from "@/features/assets/register/RegisterListScreens";

export const metadata = { title: "Asset Register" };
export default function Page() {
  return <Suspense><AssetRegisterScreen /></Suspense>;
}
