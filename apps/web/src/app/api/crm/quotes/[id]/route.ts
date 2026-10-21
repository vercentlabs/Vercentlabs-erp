import { getDealQuote, updateDealQuote } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

// One CRM quote with its lines (its deal must be visible).
export async function GET(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session, snapshot }) =>
    ok(await getDealQuote(client, crmContext(session, snapshot), (await route.params).id)),
  );
}

// Body: { kind?, validUntil?, placeOfSupply?, notes?, terms?, lines? }
export async function PATCH(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesCreateQuotation, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await updateDealQuote(client, crmContext(session, snapshot), (await route.params).id, await readBody(request))),
  );
}
