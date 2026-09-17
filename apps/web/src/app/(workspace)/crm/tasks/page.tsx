import { requireWorkspace } from "@/core/session";
import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  await requireWorkspace();
  return <TaskListScreen />;
}
