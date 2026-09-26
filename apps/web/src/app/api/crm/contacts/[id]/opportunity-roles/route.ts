import { listContactOpportunityRoles } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F003 gap-closure — the reverse view: every Opportunity this Contact holds
// an active role on (not only the ones where they're the legacy primary
// contact_id). Same governed opportunity-contacts.js service, read-only here.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listContactOpportunityRoles(client, crmContext(session), id);
    return ok({ rows });
  });
}
