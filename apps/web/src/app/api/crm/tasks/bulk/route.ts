import { bulkUpdateTasks } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/tasks/server/task-http";

// Body: { action: assign | priority | reschedule | complete | cancel, taskIds, assignedTo?, priority?, dueDate?, shiftDays?, reason? }
// Each task is checked on its own; the result says which succeeded and why the others did not.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView, billingWrite: true }, async ({ client, session }) => ok(await bulkUpdateTasks(client, crmContext(session), await readBody(request))));
}
