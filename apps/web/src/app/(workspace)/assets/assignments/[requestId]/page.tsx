import { Suspense } from "react";

import { AssignmentDetailScreen } from "@/features/assets/assignments/AssignmentScreens";

export const metadata = { title: "Asset assignment" };
export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <Suspense><AssignmentDetailScreen requestId={requestId} /></Suspense>;
}
