import { Suspense } from "react";

import { MaintenanceRequestScreen } from "@/features/assets/maintenance/MaintenanceScreens";

export const metadata = { title: "Maintenance request" };
export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <Suspense><MaintenanceRequestScreen requestId={requestId} /></Suspense>;
}
