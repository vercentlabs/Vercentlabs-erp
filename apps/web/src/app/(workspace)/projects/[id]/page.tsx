import { Suspense } from "react";

import { ProjectDetailScreen } from "@/features/projects/screens/ProjectDetailScreen";

export const metadata = { title: "Project" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ProjectDetailScreen projectId={id} /></Suspense>;
}
