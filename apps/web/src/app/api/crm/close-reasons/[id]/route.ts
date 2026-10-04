import { deleteCloseReason, updateCloseReason } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

type Params = { params: Promise<{ id: string }> };

// Rename a reason or change its rules. Its kind (won or lost) never changes.
export async function PATCH(request: Request, { params }: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManageCloseReasons, billingWrite: true }, async ({ client, session }) =>
    ok({ reason: await updateCloseReason(client, crmContext(session), (await params).id, await readBody(request)) }),
  );
}

// Only a reason that was never used can be deleted; a used one is deactivated.
export async function DELETE(request: Request, { params }: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManageCloseReasons, billingWrite: true }, async ({ client, session }) =>
    ok(await deleteCloseReason(client, crmContext(session), (await params).id)),
  );
}
