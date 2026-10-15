import { Suspense } from "react";

import { TaskDetailScreen } from "@/features/projects/screens/TaskDetailScreen";

export const metadata = { title: "Task" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><TaskDetailScreen taskId={id} /></Suspense>;
}
