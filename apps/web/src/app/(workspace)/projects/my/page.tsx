import { Suspense } from "react";

import { ProjectListScreen } from "@/features/projects/screens/ProjectListScreen";

export const metadata = { title: "My Projects" };

export default function Page() {
  return <Suspense><ProjectListScreen mine /></Suspense>;
}
