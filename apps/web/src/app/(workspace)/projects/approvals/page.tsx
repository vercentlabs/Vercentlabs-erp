import { Suspense } from "react";

import { ApprovalsScreen } from "@/features/projects/navigation/NavigationScreens";

export const metadata = { title: "Approvals" };
export default function Page() {
  return <Suspense><ApprovalsScreen /></Suspense>;
}
