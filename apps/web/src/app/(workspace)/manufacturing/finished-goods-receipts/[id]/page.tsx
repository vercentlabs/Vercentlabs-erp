import { Suspense } from "react";

import { FinishedGoodsReceiptDetailScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptDetailScreen";

export const metadata = { title: "Finished-goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><FinishedGoodsReceiptDetailScreen receiptId={id} /></Suspense>;
}
