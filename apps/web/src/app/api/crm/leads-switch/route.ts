import { leadsEnabled, setLeadsEnabled } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Whether the organization works with leads (CRM plan 5.7).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => ok({ leadsEnabled: await leadsEnabled(client, session.organizationId) }));
}

// Body: { enabled }
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await setLeadsEnabled(client, crmContext(session, snapshot), (await readBody(request)).enabled !== false)));
}
