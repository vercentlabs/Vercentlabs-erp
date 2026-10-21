import { Suspense } from "react";

import { NewLocationScreen } from "@/features/assets/locations/LocationScreens";

export const metadata = { title: "New asset location" };
export default function Page() {
  return <Suspense><NewLocationScreen /></Suspense>;
}
