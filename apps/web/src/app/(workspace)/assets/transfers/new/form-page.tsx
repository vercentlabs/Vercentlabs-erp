import { Suspense } from "react";

import { NewTransferScreen } from "@/features/assets/transfers/TransferScreens";

export const metadata = { title: "New transfer" };
export default function Page() {
  return <Suspense><NewTransferScreen /></Suspense>;
}
