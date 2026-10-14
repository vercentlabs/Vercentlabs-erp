import { Suspense } from "react";

import { MaterialConsumptionFormScreen } from "@/features/manufacturing/consumption/screens/MaterialConsumptionFormScreen";

export const metadata = { title: "Edit material consumption" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialConsumptionFormScreen consumptionId={id} /></Suspense>;
}
