import { Suspense } from "react";

import { MilestoneQueueScreen } from "@/features/projects/screens/MilestoneQueueScreen";

export const metadata = { title: "Milestones" };

export default function Page() {
  return <Suspense><MilestoneQueueScreen /></Suspense>;
}
