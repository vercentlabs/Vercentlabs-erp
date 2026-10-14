import { Suspense } from "react";

import { MaterialConsumptionDetailScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionDetailScreen";

export const metadata = { title: "Material consumption" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialConsumptionDetailScreen consumptionId={id} /></Suspense>;
}
