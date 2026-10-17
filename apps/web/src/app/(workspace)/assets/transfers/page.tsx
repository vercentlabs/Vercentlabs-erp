import { Suspense } from "react";

import { TransfersWorkspaceScreen } from "@/features/assets/transfers/TransferScreens";

export const metadata = { title: "Asset transfers" };
export default function Page() {
  return <Suspense><TransfersWorkspaceScreen /></Suspense>;
}
