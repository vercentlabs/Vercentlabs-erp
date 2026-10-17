import { Suspense } from "react";

import { LocationDirectoryScreen } from "@/features/assets/locations/LocationScreens";

export const metadata = { title: "Asset locations" };
export default function Page() {
  return <Suspense><LocationDirectoryScreen /></Suspense>;
}
