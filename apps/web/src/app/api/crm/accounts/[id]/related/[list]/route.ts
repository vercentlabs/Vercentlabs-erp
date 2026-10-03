import { listAccountRelated } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

type Params = { params: Promise<{ id: string; list: string }> };

// A read-only related list on the account: leads, opportunities, quotations,
// orders, returns, invoices, payments, projects or tickets.
export async function GET(request: Request, route: Params) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) => {
    const { id, list } = await route.params;
    return ok({ rows: await listAccountRelated(client, crmContext(session), id, list) });
  });
}
