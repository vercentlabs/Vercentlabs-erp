import { Suspense } from "react";

import { ProductionEntryDetailScreen } from "@/features/manufacturing/production/screens/ProductionEntryDetailScreen";

export const metadata = { title: "Production entry" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ProductionEntryDetailScreen entryId={id} /></Suspense>;
}
