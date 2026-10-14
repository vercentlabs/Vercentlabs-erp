import { Suspense } from "react";

import { VarianceExceptionScreen } from "@/features/manufacturing/variance/screens/VarianceExceptionScreen";

export const metadata = { title: "Variance exception" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><VarianceExceptionScreen exceptionId={id} /></Suspense>;
}
