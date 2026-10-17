import { Suspense } from "react";

import { OpeningBatchScreen } from "@/features/assets/opening/OpeningScreens";

export const metadata = { title: "Migration batch" };
export default async function Page({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <Suspense><OpeningBatchScreen batchId={batchId} /></Suspense>;
}
