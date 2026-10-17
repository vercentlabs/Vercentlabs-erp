import { Suspense } from "react";

import { CapitalizationRequestScreen } from "@/features/assets/capitalization/CapitalizationScreens";

export const metadata = { title: "Capitalization request" };
export default async function Page({ params }: { params: Promise<{ capId: string }> }) {
  const { capId } = await params;
  return <Suspense><CapitalizationRequestScreen capId={capId} /></Suspense>;
}
