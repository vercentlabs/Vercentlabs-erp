import { createQuotationFromOpportunity, listOpportunityQuotations, setPrimaryOpportunityQuotation } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ quotations: await listOpportunityQuotations(client, crmContext(session), (await route.params).id) }),
  );
}

// Starts a quotation: returns what the Sales quotation form begins with
// (customer, contact, product lines). The quotation itself is saved by Sales.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session }) =>
    ok({ draft: await createQuotationFromOpportunity(client, crmContext(session), (await route.params).id) }),
  );
}

// Marks one of the deal's quotations as the primary one. Body: { quotationId | null }
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await setPrimaryOpportunityQuotation(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
