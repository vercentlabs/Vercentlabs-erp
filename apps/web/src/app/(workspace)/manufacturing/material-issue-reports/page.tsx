import { Suspense } from "react";

import { MaterialIssueReportsScreen } from "@/features/manufacturing/issues/screens/MaterialIssueReportsScreen";

export const metadata = { title: "Material Issue Reports" };

export default function Page() {
  return <Suspense><MaterialIssueReportsScreen /></Suspense>;
}
