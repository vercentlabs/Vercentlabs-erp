import { completeFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type FollowUpRouteParams } from "@/features/crm/follow-ups/server/follow-up-http";

// Body: { outcome?, notes?, expectedUpdatedAt?, nextFollowUp?: { type?, scheduledDate, scheduledTime? }, nextTask?: { title, dueDate } }
export async function POST(request: Request, route: FollowUpRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView, billingWrite: true }, async ({ client, session }) =>
    ok(await completeFollowUp(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
