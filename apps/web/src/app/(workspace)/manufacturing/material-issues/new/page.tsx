import { Suspense } from "react";

import { MaterialIssueFormScreen } from "@/features/manufacturing/issues/screens/MaterialIssueFormScreen";

export const metadata = { title: "New material issue" };

// Started from a manufacturing order: /manufacturing/material-issues/new?orderId=...
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  return <Suspense><MaterialIssueFormScreen orderId={orderId} /></Suspense>;
}
