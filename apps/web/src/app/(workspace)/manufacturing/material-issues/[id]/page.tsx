import { Suspense } from "react";

import { MaterialIssueDetailScreen } from "@/features/manufacturing/issues/screens/MaterialIssueDetailScreen";

export const metadata = { title: "Material issue" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialIssueDetailScreen issueId={id} /></Suspense>;
}
