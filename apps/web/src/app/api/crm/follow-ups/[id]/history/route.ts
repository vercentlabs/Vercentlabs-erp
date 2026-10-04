import { listFollowUpHistory } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type FollowUpRouteParams } from "@/features/crm/follow-ups/server/follow-up-http";

export async function GET(request: Request, route: FollowUpRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView }, async ({ client, session }) => ok({ history: await listFollowUpHistory(client, crmContext(session), (await route.params).id) }));
}
