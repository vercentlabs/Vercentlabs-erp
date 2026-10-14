import { Suspense } from "react";

import { FinishedGoodsReceiptReportsScreen } from "@/features/manufacturing/receipts/screens/FinishedGoodsReceiptReportsScreen";

export const metadata = { title: "Finished-Goods Receipt Reports" };

export default function Page() {
  return <Suspense><FinishedGoodsReceiptReportsScreen /></Suspense>;
}
