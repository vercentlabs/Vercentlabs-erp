import { Suspense } from "react";

import { ScrapFormScreen } from "@/features/manufacturing/scrap/screens/ScrapFormScreen";

export const metadata = { title: "Record scrap" };

// Started from a manufacturing order: /manufacturing/scrap/new?orderId=...&type=ISSUED_MATERIAL|REJECTED_OUTPUT
export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string; type?: string }> }) {
  const { orderId, type } = await searchParams;
  return <Suspense><ScrapFormScreen orderId={orderId} type={type === "REJECTED_OUTPUT" ? "REJECTED_OUTPUT" : "ISSUED_MATERIAL"} /></Suspense>;
}
