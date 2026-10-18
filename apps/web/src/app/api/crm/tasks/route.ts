import { createTask, listTasks } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, taskFiltersFromUrl } from "@/features/crm/tasks/server/task-http";

// The tasks the caller can see, for one view and set of filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView }, async ({ client, session, snapshot }) => {
    const { tasks, ...page } = await listTasks(client, crmContext(session, snapshot), taskFiltersFromUrl(new URL(request.url)));
    return ok({ rows: tasks, ...page });
  });
}

// Body: { title, dueDate, dueTime?, description?, priority?, reminderOffsetMinutes? | reminderAt?, relatedType?, relatedId?, assignedTo?, idempotencyKey? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ record: await createTask(client, crmContext(session, snapshot), await readBody(request)) }, 201),
  );
}
