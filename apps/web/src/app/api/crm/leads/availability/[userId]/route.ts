import { setSalespersonAvailability } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Set a salesperson's capacity or pause ({ monthlyLeadCapacity?, pausedFrom?, pausedUntil?, pauseReason? }); for whoever manages assignment.
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ person: await setSalespersonAvailability(client, crmContext(session, snapshot), userId, await readBody(request)) }));
}
