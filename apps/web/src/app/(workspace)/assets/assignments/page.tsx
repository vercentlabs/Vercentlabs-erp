import { Suspense } from "react";

import { AssignmentsWorkspaceScreen } from "@/features/assets/assignments/AssignmentScreens";

export const metadata = { title: "Asset assignments" };
export default function Page() {
  return <Suspense><AssignmentsWorkspaceScreen /></Suspense>;
}
