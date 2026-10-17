import { Suspense } from "react";

import { RegistrationBatchScreen } from "@/features/assets/invoices/InvoiceScreens";

export const metadata = { title: "Invoice registration" };
export default async function Page({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <Suspense><RegistrationBatchScreen batchId={batchId} /></Suspense>;
}
