import { getTaskSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The caller's overdue, due-today and upcoming counts, and a manager's team overdue count.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.tasksView }, async ({ client, session }) => ok({ summary: await getTaskSummary(client, crmContext(session)) }));
}
