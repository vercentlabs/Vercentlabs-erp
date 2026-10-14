import { Suspense } from "react";

import { MaterialIssuePrintScreen } from "@/features/manufacturing/issues/screens/MaterialIssuePrintScreen";

export const metadata = { title: "Material Issue Note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MaterialIssuePrintScreen issueId={id} /></Suspense>;
}
