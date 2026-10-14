import { Suspense } from "react";

import { FinishedGoodsReceiptListScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptListScreen";

export const metadata = { title: "Finished-Goods Receipts" };

export default function Page() {
  return <Suspense><FinishedGoodsReceiptListScreen /></Suspense>;
}
