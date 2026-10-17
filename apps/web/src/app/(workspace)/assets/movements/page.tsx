import { Suspense } from "react";

import { MovementsWorkspaceScreen } from "@/features/assets/movements/MovementScreens";

export const metadata = { title: "Asset movement history" };
export default function Page() {
  return <Suspense><MovementsWorkspaceScreen /></Suspense>;
}
