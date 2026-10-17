import { Suspense } from "react";

import { TeamTimesheetsScreen } from "@/features/projects/timesheets/TeamScreens";

export const metadata = { title: "Team Timesheets" };

export default function Page() {
  return <Suspense><TeamTimesheetsScreen /></Suspense>;
}
