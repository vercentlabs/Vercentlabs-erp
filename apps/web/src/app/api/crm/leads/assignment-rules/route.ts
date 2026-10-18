import { listLeadAssignmentRules, saveLeadAssignmentRule } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Rule management needs crm.leads.manage_assignment_rules, which the operations check.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session, snapshot }) =>
    ok({ rules: await listLeadAssignmentRules(client, crmContext(session, snapshot)) }),
  );
}

// Body: { name, conditions: [{ field, operator, value? }], targetType, targetUserId?, targetTeamId?, strategy?, isActive? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ rule: await saveLeadAssignmentRule(client, crmContext(session, snapshot), null, await readBody(request)) }, 201),
  );
}
