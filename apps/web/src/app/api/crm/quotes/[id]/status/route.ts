import { setDealQuoteStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Marks a quote sent (it went out another way), accepted or declined. Body: { status }
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await setDealQuoteStatus(client, crmContext(session, snapshot), (await route.params).id, String((await readBody(request)).status ?? ""))),
  );
}
