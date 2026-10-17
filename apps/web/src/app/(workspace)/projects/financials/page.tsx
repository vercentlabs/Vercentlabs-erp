import { Suspense } from "react";

import { ProjectFinancialsScreen } from "@/features/projects/navigation/NavigationScreens";

export const metadata = { title: "Project Financials" };
export default function Page() {
  return <Suspense><ProjectFinancialsScreen /></Suspense>;
}
