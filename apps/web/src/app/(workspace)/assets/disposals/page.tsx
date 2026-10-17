import { Suspense } from "react";

import { DisposalWorkspaceScreen } from "@/features/assets/disposals/DisposalScreens";

export const metadata = { title: "Disposals" };
export default function Page() {
  return <Suspense><DisposalWorkspaceScreen /></Suspense>;
}
