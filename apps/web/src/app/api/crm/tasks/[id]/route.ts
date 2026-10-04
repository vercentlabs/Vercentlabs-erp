import { deleteTask, getTask, updateTask } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type TaskRouteParams } from "@/features/crm/tasks/server/task-http";

export async function GET(request: Request, route: TaskRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView }, async ({ client, session }) => ok({ record: await getTask(client, crmContext(session), (await route.params).id) }));
}

// Body: any of { title, description, priority, dueDate, dueTime, reminderOffsetMinutes, reminderAt, relatedType, relatedId, reason }, plus expectedUpdatedAt.
export async function PATCH(request: Request, route: TaskRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView, billingWrite: true }, async ({ client, session }) =>
    ok({ record: await updateTask(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}

// Only a task that was never worked on; anything else is cancelled.
export async function DELETE(request: Request, route: TaskRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView, billingWrite: true }, async ({ client, session }) => ok(await deleteTask(client, crmContext(session), (await route.params).id)));
}
