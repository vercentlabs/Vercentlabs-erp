import { Suspense } from "react";

import { QiFormScreen } from "@/features/manufacturing/quality/screens/QiFormScreen";

export const metadata = { title: "Start an inspection" };

// Started from the inspection queue or an order's Quality tab: /manufacturing/quality-inspections/new?orderId=...&entryId=...
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string; entryId?: string }> }) {
  const { orderId, entryId } = await searchParams;
  return <Suspense><QiFormScreen orderId={orderId} entryId={entryId} /></Suspense>;
}
