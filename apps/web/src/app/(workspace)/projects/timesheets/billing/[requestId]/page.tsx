import { Suspense } from "react";

import { BillingRequestScreen } from "@/features/projects/billable/BillingScreens";

export const metadata = { title: "Billing request" };

export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <Suspense><BillingRequestScreen requestId={requestId} /></Suspense>;
}
