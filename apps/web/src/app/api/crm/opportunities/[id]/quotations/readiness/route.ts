import { getQuotationReadiness } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { OpportunityRouteParams } from "@/features/crm/opportunities/server/opportunity-http";

// What the Create Quotation dialog shows: checks, customer resolution, contacts, addresses, lines and Sales defaults.
export async function GET(request: Request, route: OpportunityRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation }, async ({ client, session }) =>
    ok({ readiness: await getQuotationReadiness(client, crmContext(session), (await route.params).id) }),
  );
}
