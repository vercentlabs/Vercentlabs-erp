import { Suspense } from "react";

import { ProductionEntryFormScreen } from "@/features/manufacturing/production/screens/ProductionEntryFormScreen";

export const metadata = { title: "Edit production entry" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ProductionEntryFormScreen entryId={id} /></Suspense>;
}
