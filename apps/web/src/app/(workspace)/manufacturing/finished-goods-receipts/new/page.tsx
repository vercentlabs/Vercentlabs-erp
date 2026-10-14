import { Suspense } from "react";

import { FinishedGoodsReceiptFormScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptFormScreen";

export const metadata = { title: "Receive finished goods" };

// Started from a manufacturing order: /manufacturing/finished-goods-receipts/new?orderId=...
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  return <Suspense><FinishedGoodsReceiptFormScreen orderId={orderId} /></Suspense>;
}
