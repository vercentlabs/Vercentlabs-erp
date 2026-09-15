import { requireWorkspace } from "@/core/session";
import { TaskDetailScreen } from "@/features/crm/tasks/screens/TaskDetailScreen";

export const metadata = { title: "Task" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspace();
  const { id } = await params;
  return <TaskDetailScreen taskId={id} />;
}
