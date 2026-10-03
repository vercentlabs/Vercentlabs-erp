import { scheduleLeadFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Body: { type, dueAt, assignedTo?, notes?, subject? }
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ followUp: await scheduleLeadFollowUp(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
