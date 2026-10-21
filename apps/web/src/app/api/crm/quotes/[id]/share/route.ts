import { dealQuoteShareLink } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The customer's link to the quote (the same one every time), for WhatsApp or a message.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await dealQuoteShareLink(client, crmContext(session, snapshot), (await route.params).id, process.env)),
  );
}
