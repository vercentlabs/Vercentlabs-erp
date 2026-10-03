import { getLeadQualificationSettings, saveLeadQualificationSettings } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Which criteria must be met before a lead can be qualified.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ requirements: await getLeadQualificationSettings(client, crmContext(session)) }),
  );
}

// Body: { need?, budget?, authority?, timeline? } — booleans
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) =>
    ok({ requirements: await saveLeadQualificationSettings(client, crmContext(session), await readBody(request)) }),
  );
}
