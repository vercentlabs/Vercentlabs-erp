import { Suspense } from "react";

import { MaintenanceWorkOrderScreen } from "@/features/assets/maintenance/MaintenanceScreens";

export const metadata = { title: "Maintenance Work Order" };
export default async function Page({ params }: { params: Promise<{ workOrderId: string }> }) {
  const { workOrderId } = await params;
  return <Suspense><MaintenanceWorkOrderScreen workOrderId={workOrderId} /></Suspense>;
}
