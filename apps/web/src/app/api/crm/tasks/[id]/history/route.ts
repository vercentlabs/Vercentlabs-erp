import { listTaskHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type TaskRouteParams } from "@/features/crm/tasks/server/task-http";

export async function GET(request: Request, route: TaskRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView }, async ({ client, session }) => ok({ history: await listTaskHistory(client, crmContext(session), (await route.params).id) }));
}
