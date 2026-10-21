import { createDealQuote, listDealQuotes } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// The deal's CRM quotes (quotations and proformas made without the Sales app).
export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session, snapshot }) =>
    ok(await listDealQuotes(client, crmContext(session, snapshot), (await route.params).id)),
  );
}

// A new draft quote from the deal. Body: { kind?: "quotation" | "proforma" }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await createDealQuote(client, crmContext(session, snapshot), (await route.params).id, await readBody(request)), 201),
  );
}
