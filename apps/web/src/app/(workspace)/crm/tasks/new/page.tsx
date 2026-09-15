import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { TaskFormScreen } from "@/features/crm/tasks/screens/TaskFormScreen";

export const metadata = { title: "New task" };

export default async function NewTaskPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  return <TaskFormScreen canManage={canManage} />;
}
