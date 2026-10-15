import { Suspense } from "react";

import { TaskQueueScreen } from "@/features/projects/screens/TaskQueueScreen";

export const metadata = { title: "Tasks" };

export default function Page() {
  return <Suspense><TaskQueueScreen /></Suspense>;
}
