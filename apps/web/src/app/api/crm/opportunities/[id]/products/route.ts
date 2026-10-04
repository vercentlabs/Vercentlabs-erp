import { addOpportunityProduct, listOpportunityProducts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) =>
    ok({ products: await listOpportunityProducts(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: { productId, quantity?, unitPrice?, discountPercent?, description? }
export async function POST(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ line: await addOpportunityProduct(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
