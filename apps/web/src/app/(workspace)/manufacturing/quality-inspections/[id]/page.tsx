import { Suspense } from "react";

import { QiDetailScreen } from "@/features/manufacturing/quality/screens/QiDetailScreen";

export const metadata = { title: "Production inspection" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><QiDetailScreen inspectionId={id} /></Suspense>;
}
