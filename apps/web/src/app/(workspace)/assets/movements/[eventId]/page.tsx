import { Suspense } from "react";

import { MovementDetailScreen } from "@/features/assets/movements/MovementScreens";

export const metadata = { title: "Asset movement" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <Suspense><MovementDetailScreen eventId={eventId} /></Suspense>;
}
