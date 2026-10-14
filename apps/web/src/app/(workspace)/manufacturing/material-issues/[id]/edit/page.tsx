import { Suspense } from "react";

import { MaterialIssueFormScreen } from "@/features/manufacturing/issues/screens/MaterialIssueFormScreen";

export const metadata = { title: "Edit material issue" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialIssueFormScreen issueId={id} /></Suspense>;
}
