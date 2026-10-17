import { Suspense } from "react";

import { CustodyWorkspaceScreen } from "@/features/assets/custody/CustodyScreens";

export const metadata = { title: "Custody & handovers" };
export default function Page() {
  return <Suspense><CustodyWorkspaceScreen /></Suspense>;
}
