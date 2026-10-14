import { Suspense } from "react";

import { BomDetailScreen } from "@/features/manufacturing/boms/screens/BomDetailScreen";

export const metadata = { title: "Bill of materials" };

export default async function Page({ params }: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await params;
  return <Suspense><BomDetailScreen bomId={bomId} /></Suspense>;
}
