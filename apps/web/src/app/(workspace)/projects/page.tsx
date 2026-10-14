import { Suspense } from "react";

import { ProjectsOverviewScreen } from "@/features/projects/screens/ProjectsOverviewScreen";

export const metadata = { title: "Projects" };

export default function Page() {
  return <Suspense><ProjectsOverviewScreen /></Suspense>;
}
