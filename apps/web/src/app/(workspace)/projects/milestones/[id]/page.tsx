import { Suspense } from "react";

import { MilestoneDetailScreen } from "@/features/projects/screens/MilestoneDetailScreen";

export const metadata = { title: "Milestone" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MilestoneDetailScreen milestoneId={id} /></Suspense>;
}
