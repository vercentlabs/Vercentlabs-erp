import { Suspense } from "react";

import { QiPrintScreen } from "@/features/manufacturing/quality/screens/QiPrintScreen";

export const metadata = { title: "Production Inspection Report" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><QiPrintScreen inspectionId={id} /></Suspense>;
}
