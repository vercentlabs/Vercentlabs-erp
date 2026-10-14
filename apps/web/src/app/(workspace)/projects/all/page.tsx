import { Suspense } from "react";

import { ProjectListScreen } from "@/features/projects/screens/ProjectListScreen";

export const metadata = { title: "All Projects" };

export default function Page() {
  return <Suspense><ProjectListScreen /></Suspense>;
}
