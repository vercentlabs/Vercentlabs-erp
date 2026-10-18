import { createCampaign, listCampaigns } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM › Setup › Campaigns: every campaign with its leads, deals and won value.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session, snapshot }) =>
    ok(await listCampaigns(client, crmContext(session, snapshot))));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ campaign: await createCampaign(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
