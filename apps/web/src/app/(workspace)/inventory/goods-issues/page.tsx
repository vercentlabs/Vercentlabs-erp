import { Suspense } from "react";

import { GoodsIssuesScreen } from "@/features/goods-issues/screens/GoodsIssuesScreen";

export const metadata = { title: "Goods Issues" };

export default function Page() {
  return (
    <Suspense>
      <GoodsIssuesScreen />
    </Suspense>
  );
}
