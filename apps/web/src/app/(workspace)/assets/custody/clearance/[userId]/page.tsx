import { Suspense } from "react";

import { ClearanceScreen } from "@/features/assets/custody/CustodyScreens";

export const metadata = { title: "Asset clearance" };
export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <Suspense><ClearanceScreen userId={userId} /></Suspense>;
}
