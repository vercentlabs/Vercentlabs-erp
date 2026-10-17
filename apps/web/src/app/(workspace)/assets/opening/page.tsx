import { Suspense } from "react";

import { OpeningWorkspaceScreen } from "@/features/assets/opening/OpeningScreens";

export const metadata = { title: "Opening / existing assets" };
export default function Page() {
  return <Suspense><OpeningWorkspaceScreen /></Suspense>;
}
