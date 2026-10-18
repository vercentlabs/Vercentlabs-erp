import { listSalespersonAvailability } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Each salesperson's monthly lead capacity, pause and recent leads (CRM plan 3.6).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session, snapshot }) =>
    ok({ people: await listSalespersonAvailability(client, crmContext(session, snapshot)) }));
}
