import { Suspense } from "react";

import { ProjectReportsScreen } from "@/features/projects/screens/ProjectReportsScreen";

export const metadata = { title: "Project Reports" };

export default function Page() {
  return <Suspense><ProjectReportsScreen /></Suspense>;
}
