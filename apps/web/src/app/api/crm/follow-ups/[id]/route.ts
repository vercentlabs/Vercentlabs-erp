import { deleteFollowUp, getFollowUp, updateFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type FollowUpRouteParams } from "@/features/crm/follow-ups/server/follow-up-http";

export async function GET(request: Request, route: FollowUpRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView }, async ({ client, session }) => ok({ record: await getFollowUp(client, crmContext(session), (await route.params).id) }));
}

// Body: any of { subject, notes, type, contactId, reminderOffsetMinutes, reminderAt }, plus expectedUpdatedAt.
export async function PATCH(request: Request, route: FollowUpRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView, billingWrite: true }, async ({ client, session }) =>
    ok({ record: await updateFollowUp(client, crmContext(session), (await route.params).id, await readBody(request)) }),
  );
}

export async function DELETE(request: Request, route: FollowUpRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView, billingWrite: true }, async ({ client, session }) => ok(await deleteFollowUp(client, crmContext(session), (await route.params).id)));
}
