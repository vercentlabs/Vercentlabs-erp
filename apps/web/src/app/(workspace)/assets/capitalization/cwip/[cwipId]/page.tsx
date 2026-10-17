import { Suspense } from "react";

import { CwipScreen } from "@/features/assets/capitalization/CapitalizationScreens";

export const metadata = { title: "Capital work in progress" };
export default async function Page({ params }: { params: Promise<{ cwipId: string }> }) {
  const { cwipId } = await params;
  return <Suspense><CwipScreen cwipId={cwipId} /></Suspense>;
}
