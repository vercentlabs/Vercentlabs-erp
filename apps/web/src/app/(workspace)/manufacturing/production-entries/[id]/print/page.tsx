import { Suspense } from "react";

import { ProductionEntryPrintScreen } from "@/features/manufacturing/production/screens/ProductionEntryPrintScreen";

export const metadata = { title: "Production Entry" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ProductionEntryPrintScreen entryId={id} /></Suspense>;
}
