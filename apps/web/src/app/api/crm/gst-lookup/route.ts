import { getGstLookupSettings, saveGstLookupSettings } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The company's own GST lookup provider (CRM audit). GET; PUT { url, apiKey?, keyHeader? } or { clear: true }.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ settings: await getGstLookupSettings(client, crmContext(session, snapshot)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ settings: await saveGstLookupSettings(client, crmContext(session, snapshot), await readBody(request)) }));
}
