import { createQuotationFromOpportunity, listOpportunityQuotations, setPrimaryOpportunityQuotation, type QuotationFromOpportunityInput } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// Every quotation raised from the opportunity (shown only to users who may see Sales).
export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok(await listOpportunityQuotations(client, crmContext(session), (await route.params).id)),
  );
}

// Creates the Draft quotation from the opportunity in one transaction: customer
// resolution, lines, Sales pricing and tax. Body: see createQuotationFromOpportunity.
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session }) =>
    ok({ result: await createQuotationFromOpportunity(client, crmContext(session), (await route.params).id, (await readBody(request)) as unknown as QuotationFromOpportunityInput) }, 201),
  );
}

// Marks one of the deal's quotations as the primary one. Body: { quotationId | null }
export async function PATCH(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await setPrimaryOpportunityQuotation(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
