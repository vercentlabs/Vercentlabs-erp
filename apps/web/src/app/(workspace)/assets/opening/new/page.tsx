import { Suspense } from "react";

import { ManualOpeningScreen } from "@/features/assets/opening/OpeningScreens";

export const metadata = { title: "Add an existing asset" };
export default function Page() {
  return <Suspense><ManualOpeningScreen /></Suspense>;
}
