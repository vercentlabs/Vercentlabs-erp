import { archiveLead, getLead, updateLead } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ record: await getLead(client, crmContext(session), (await route.params).id) }),
  );
}

export async function PATCH(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { allowDuplicate, expectedUpdatedAt, ...input } = await readBody(request);
    const record = await updateLead(client, context, (await route.params).id, input, {
      allowDuplicate: allowDuplicate === true,
      expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : null,
    });
    return ok({ record });
  });
}

// Archives the lead. Leads are never hard-deleted.
export async function DELETE(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await archiveLead(client, crmContext(session), (await route.params).id)),
  );
}
