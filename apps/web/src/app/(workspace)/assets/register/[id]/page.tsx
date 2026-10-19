import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { Suspense } from "react";

import { AssetDetailScreen } from "@/features/assets/register/AssetDetailScreen";

export const metadata = { title: "Asset" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <Suspense><AssetDetailScreen assetId={id} /></Suspense>
      <RecordThreadPanel type="assets.asset" id={id} />
    </div>
  );
}
