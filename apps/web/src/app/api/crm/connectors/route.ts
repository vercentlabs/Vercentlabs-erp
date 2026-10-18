import { createLeadConnector, listLeadConnectors, listLeadProviders } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM › Setup › Lead connectors: IndiaMART, JustDial, TradeIndia, Meta and Google lead forms.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage }, async ({ client, session, snapshot }) =>
    ok({ connectors: await listLeadConnectors(client, crmContext(session, snapshot)), providers: listLeadProviders() }));
}

// The webhook key and any generated credential are in this response once.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.captureManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await createLeadConnector(client, crmContext(session, snapshot), await readBody(request)), 201));
}
