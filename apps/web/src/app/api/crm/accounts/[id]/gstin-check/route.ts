import { getAccount, gstLookupConfiguredFor, latestGstinCheck, verifyAccountGstin } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

type Params = { params: Promise<{ id: string }> };

// The company's GSTIN as the GST register last saw it (CRM plan 5.6).
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const account = await getAccount(client, context, id);
    return ok({ check: account.gstin ? await latestGstinCheck(client, context.organizationId, account.gstin) : null, configured: await gstLookupConfiguredFor(client, context.organizationId) });
  });
}

// Checks the company's GSTIN with the GST register now.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok(await verifyAccountGstin(client, crmContext(session, snapshot), id)));
}
