import { Suspense } from "react";

import { MovementEventScreen } from "@/features/movement-history/screens/MovementEventScreen";

export const metadata = { title: "Movement" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <MovementEventScreen groupId={id} />
    </Suspense>
  );
}
