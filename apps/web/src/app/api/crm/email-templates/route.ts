import { createEmailTemplate, listEmailTemplates } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Email templates (?all=1 includes those switched off; for CRM settings managers).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ templates: await listEmailTemplates(client, crmContext(session, snapshot), { includeInactive: new URL(request.url).searchParams.get("all") === "1" }) }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ template: await createEmailTemplate(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
