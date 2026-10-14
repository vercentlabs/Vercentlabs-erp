import { Suspense } from "react";

import { BomCompareScreen } from "@/features/manufacturing/boms/screens/BomCompareScreen";

export const metadata = { title: "Compare BOM revisions" };

export default async function Page({ params }: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await params;
  return <Suspense><BomCompareScreen bomId={bomId} /></Suspense>;
}
