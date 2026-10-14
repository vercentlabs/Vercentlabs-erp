import { Suspense } from "react";

import { FinishedGoodsReceiptPrintScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptPrintScreen";

export const metadata = { title: "Finished-Goods Receipt Note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><FinishedGoodsReceiptPrintScreen receiptId={id} /></Suspense>;
}
