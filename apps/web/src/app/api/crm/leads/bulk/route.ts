import { bulkAssignLeads, bulkChangeLeadStage, bulkDisqualifyLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Bulk operations on selected leads. Body: { action, leadIds, ... }
//   assign      { ownerUserId?, teamId? }
//   stage       { stage }
//   disqualify  { reason, notes? }
// Each lead succeeds or fails on its own; the response lists every outcome.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { action, ...input } = await readBody(request);
    const payload = input as { leadIds: string[] } & Record<string, unknown>;
    if (action === "assign") return ok(await bulkAssignLeads(client, context, payload));
    if (action === "stage") return ok(await bulkChangeLeadStage(client, context, payload as { leadIds: string[]; stage: string }));
    if (action === "disqualify") return ok(await bulkDisqualifyLeads(client, context, payload as { leadIds: string[]; reason: string }));
    throw new HttpError(400, "Unknown bulk action.");
  });
}
