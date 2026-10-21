import { Suspense } from "react";

import { FinishedGoodsReceiptFormScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptFormScreen";

export const metadata = { title: "Edit finished-goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><FinishedGoodsReceiptFormScreen receiptId={id} /></Suspense>;
}
