import { Suspense } from "react";

import { NewAssignmentScreen } from "@/features/assets/assignments/AssignmentScreens";

export const metadata = { title: "New assignment" };
export default function Page() {
  return <Suspense><NewAssignmentScreen /></Suspense>;
}
