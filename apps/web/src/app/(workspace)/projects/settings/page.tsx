import { Suspense } from "react";

import { ProjectSettingsScreen } from "@/features/projects/screens/ProjectSettingsScreen";

export const metadata = { title: "Project Settings" };

export default function Page() {
  return <Suspense><ProjectSettingsScreen /></Suspense>;
}
