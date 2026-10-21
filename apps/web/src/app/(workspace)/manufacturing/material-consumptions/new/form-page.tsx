import { Suspense } from "react";

import { MaterialConsumptionFormScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionFormScreen";

export const metadata = { title: "Record material consumption" };

// Started from an order in production: /manufacturing/material-consumptions/new?orderId=...
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  return <Suspense><MaterialConsumptionFormScreen orderId={orderId} /></Suspense>;
}
