import { addLeadActivity, listLeadActivities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Tasks, follow-ups and logged activities on the lead, newest first.
export async function GET(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ activities: await listLeadActivities(client, crmContext(session), (await route.params).id) }),
  );
}

// Logs a call, email, meeting or general activity. Body: { type, subject?,
// notes?, outcome?, occurredAt?, nextAction?: { type, dueAt, assignedTo?, notes? } }
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await addLeadActivity(client, crmContext(session), (await route.params).id, await readBody(request))),
  );
}
