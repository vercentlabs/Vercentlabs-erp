import { Suspense } from "react";

import { AccountingPage } from "@/features/accounting/AccountingPage";

export const metadata = { title: "Receipts" };

export default function ReceiptsPage() {
  return <Suspense><AccountingPage name="receipts" /></Suspense>;
}
