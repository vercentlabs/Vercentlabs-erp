import { Suspense } from "react";

import { MyWorkScreen } from "@/features/projects/navigation/NavigationScreens";

export const metadata = { title: "My Work" };
export default function Page() {
  return <Suspense><MyWorkScreen /></Suspense>;
}
