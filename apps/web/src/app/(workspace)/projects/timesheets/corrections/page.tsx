import { Suspense } from "react";

import { CorrectionsScreen } from "@/features/projects/timesheets/TeamScreens";

export const metadata = { title: "Time Corrections" };

export default function Page() {
  return <Suspense><CorrectionsScreen /></Suspense>;
}
