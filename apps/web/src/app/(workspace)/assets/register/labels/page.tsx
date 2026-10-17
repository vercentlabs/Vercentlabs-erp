import { Suspense } from "react";

import { PrintLabelsScreen } from "@/features/assets/register/IdentificationScreens";

export const metadata = { title: "Print asset labels" };
export default function Page() {
  return <Suspense><PrintLabelsScreen /></Suspense>;
}
