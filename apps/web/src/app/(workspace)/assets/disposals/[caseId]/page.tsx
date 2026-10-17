import { Suspense } from "react";

import { DisposalCaseScreen } from "@/features/assets/disposals/DisposalScreens";

export const metadata = { title: "Asset disposal" };
export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <Suspense><DisposalCaseScreen caseId={caseId} /></Suspense>;
}
