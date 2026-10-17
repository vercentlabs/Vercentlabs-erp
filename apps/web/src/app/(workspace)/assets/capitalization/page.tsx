import { Suspense } from "react";

import { CapitalizationWorkspaceScreen } from "@/features/assets/capitalization/CapitalizationScreens";

export const metadata = { title: "Purchases & capitalization" };
export default function Page() {
  return <Suspense><CapitalizationWorkspaceScreen /></Suspense>;
}
