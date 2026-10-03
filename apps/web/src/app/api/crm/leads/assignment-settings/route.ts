import { getLeadAssignmentSettings, saveLeadAssignmentSettings } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ settings: await getLeadAssignmentSettings(client, crmContext(session)) }),
  );
}

// Body: { allowSelfAssignment?, manualCreationMode?, fallbackMode?, fallbackUserId?, fallbackTeamId? }
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session }) =>
    ok({ settings: await saveLeadAssignmentSettings(client, crmContext(session), await readBody(request)) }),
  );
}
