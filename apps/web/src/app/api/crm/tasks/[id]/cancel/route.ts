import { cancelTask } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type TaskRouteParams } from "@/features/crm/tasks/server/task-http";

// Body: { reason?, expectedUpdatedAt? }
export async function POST(request: Request, route: TaskRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView, billingWrite: true }, async ({ client, session }) =>
    ok(await cancelTask(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
