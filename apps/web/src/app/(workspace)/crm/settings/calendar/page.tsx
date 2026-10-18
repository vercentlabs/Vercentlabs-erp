import { Suspense } from "react";

import { requireWorkspace } from "@/core/session";
import { MyCalendarScreen } from "@/features/crm/meetings/screens/MyCalendarScreen";

export const metadata = { title: "My calendar" };

export default async function Page() {
  await requireWorkspace();
  return <Suspense><MyCalendarScreen /></Suspense>;
}
