import { Suspense } from "react";

import { MaintenanceWorkspaceScreen } from "@/features/assets/maintenance/MaintenanceScreens";

export const metadata = { title: "Maintenance" };
export default function Page() {
  return <Suspense><MaintenanceWorkspaceScreen /></Suspense>;
}
