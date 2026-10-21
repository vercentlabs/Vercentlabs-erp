import { getZoomSettings, saveZoomSettings } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The company's Zoom app (CRM audit): GET whether it is connected; PUT { accountId, clientId, clientSecret? } or { disconnect: true }.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ settings: await getZoomSettings(client, crmContext(session, snapshot)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ settings: await saveZoomSettings(client, crmContext(session, snapshot), await readBody(request)) }));
}
