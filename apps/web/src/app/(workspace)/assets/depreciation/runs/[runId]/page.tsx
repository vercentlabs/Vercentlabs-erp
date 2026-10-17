import { Suspense } from "react";

import { DepreciationRunScreen } from "@/features/assets/depreciation/DepreciationScreens";

export const metadata = { title: "Depreciation run" };
export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <Suspense><DepreciationRunScreen runId={runId} /></Suspense>;
}
