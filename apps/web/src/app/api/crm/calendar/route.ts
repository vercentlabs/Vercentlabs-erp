import { listCalendarConnections } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The signed-in person's calendar connections (Google, Microsoft) and which this workspace can offer (CRM plan 4.5).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ connections: await listCalendarConnections(client, crmContext(session, snapshot)) }));
}
