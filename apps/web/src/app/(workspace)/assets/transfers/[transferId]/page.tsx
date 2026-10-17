import { Suspense } from "react";

import { TransferDetailScreen } from "@/features/assets/transfers/TransferScreens";

export const metadata = { title: "Asset transfer" };
export default async function Page({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId } = await params;
  return <Suspense><TransferDetailScreen transferId={transferId} /></Suspense>;
}
