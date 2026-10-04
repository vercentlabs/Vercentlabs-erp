import { requireWorkspace } from "@/core/session";
import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";

export const metadata = { title: "Tasks" };

// CRM Tasks. ?view=overdue | due_today | upcoming | … opens a view; My Tasks is the default.
export default async function Page() {
  await requireWorkspace();
  return <TaskListScreen />;
}
