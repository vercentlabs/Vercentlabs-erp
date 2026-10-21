import { upgradeDealQuoteToSales } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// With Sales switched on: the quote becomes a Draft Sales quotation. Body: the customer choice the deal's quotation needs, if any.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ result: await upgradeDealQuoteToSales(client, crmContext(session, snapshot), (await route.params).id, await readBody(request)) }, 201),
  );
}
