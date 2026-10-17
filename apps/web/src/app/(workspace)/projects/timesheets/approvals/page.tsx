import { Suspense } from "react";

import { ApprovalsScreen } from "@/features/projects/timesheets/ReviewScreens";

export const metadata = { title: "Pending Approvals" };

export default function Page() {
  return <Suspense><ApprovalsScreen /></Suspense>;
}
