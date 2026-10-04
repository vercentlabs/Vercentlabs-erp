import { getFollowUpSummary } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Due today, overdue and upcoming for the caller, and a manager's team overdue count.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView }, async ({ client, session }) => ok({ summary: await getFollowUpSummary(client, crmContext(session)) }));
}
