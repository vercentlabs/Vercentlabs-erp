import { Suspense } from "react";

import { DepreciationWorkspaceScreen } from "@/features/assets/depreciation/DepreciationScreens";

export const metadata = { title: "Depreciation" };
export default function Page() {
  return <Suspense><DepreciationWorkspaceScreen /></Suspense>;
}
