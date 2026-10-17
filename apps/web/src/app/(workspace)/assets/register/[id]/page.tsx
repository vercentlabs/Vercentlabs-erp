import { Suspense } from "react";

import { AssetDetailScreen } from "@/features/assets/register/AssetDetailScreen";

export const metadata = { title: "Asset" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><AssetDetailScreen assetId={id} /></Suspense>;
}
