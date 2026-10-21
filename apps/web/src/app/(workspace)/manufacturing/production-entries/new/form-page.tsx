import { Suspense } from "react";

import { ProductionEntryFormScreen } from "@/features/manufacturing/production/screens/ProductionEntryFormScreen";

export const metadata = { title: "Record production" };

// Started from an order: /manufacturing/production-entries/new?orderId=...
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  return <Suspense><ProductionEntryFormScreen orderId={orderId} /></Suspense>;
}
