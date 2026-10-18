import { getWhatsAppSettings, saveWhatsAppSettings } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM › Setup › WhatsApp. Connecting the Cloud API returns the webhook key and verify token once.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session, snapshot }) =>
    ok({ settings: await getWhatsAppSettings(client, crmContext(session, snapshot)) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await saveWhatsAppSettings(client, crmContext(session, snapshot), await readBody(request))));
}
