import { Suspense } from "react";

import { HoldDetailScreen } from "@/features/manufacturing/holds/screens/HoldDetailScreen";

export const metadata = { title: "Production hold" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><HoldDetailScreen holdId={id} /></Suspense>;
}
