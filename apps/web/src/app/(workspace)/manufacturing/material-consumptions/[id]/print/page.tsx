import { Suspense } from "react";

import { MaterialConsumptionPrintScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionPrintScreen";

export const metadata = { title: "Material Consumption Note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialConsumptionPrintScreen consumptionId={id} /></Suspense>;
}
