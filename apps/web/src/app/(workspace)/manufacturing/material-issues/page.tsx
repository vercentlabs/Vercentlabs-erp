import { Suspense } from "react";

import { MaterialIssueListScreen } from "@/features/manufacturing/issues/screens/MaterialIssueListScreen";

export const metadata = { title: "Material Issues" };

export default function Page() {
  return <Suspense><MaterialIssueListScreen /></Suspense>;
}
