import { listLeadAssignmentRules, saveLeadAssignmentRule } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) =>
    ok({ rules: await listLeadAssignmentRules(client, crmContext(session)) }),
  );
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) =>
    ok({ rule: await saveLeadAssignmentRule(client, crmContext(session), null, await readBody(request)) }, 201),
  );
}
