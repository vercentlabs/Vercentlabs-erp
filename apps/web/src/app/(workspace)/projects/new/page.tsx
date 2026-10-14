import { Suspense } from "react";

import { ProjectFormScreen } from "@/features/projects/screens/ProjectFormScreen";

export const metadata = { title: "New project" };

export default function Page() {
  return <Suspense><ProjectFormScreen /></Suspense>;
}
