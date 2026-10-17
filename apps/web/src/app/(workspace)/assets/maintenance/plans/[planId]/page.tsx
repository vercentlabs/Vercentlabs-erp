import { Suspense } from "react";

import { MaintenancePlanScreen } from "@/features/assets/maintenance/MaintenanceScreens";

export const metadata = { title: "Preventive plan" };
export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <Suspense><MaintenancePlanScreen planId={planId} /></Suspense>;
}
