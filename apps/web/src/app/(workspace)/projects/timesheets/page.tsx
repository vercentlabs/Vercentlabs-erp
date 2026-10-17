import { Suspense } from "react";

import { MyTimesheetScreen } from "@/features/projects/timesheets/MyTimesheetScreen";

export const metadata = { title: "My Timesheets" };

export default function Page() {
  return <Suspense><MyTimesheetScreen /></Suspense>;
}
