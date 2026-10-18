import { getCrmEmailSettings, saveCrmEmailSettings } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM email settings: the reply address and the signature, with the placeholders templates may use.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ settings: await getCrmEmailSettings(client, crmContext(session, snapshot)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ settings: await saveCrmEmailSettings(client, crmContext(session, snapshot), await readBody(request)) }));
}
