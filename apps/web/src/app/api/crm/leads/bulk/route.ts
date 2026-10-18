import { bulkAssignLeads, bulkChangeLeadStage, bulkConvertLeads, bulkDisqualifyLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Bulk operations on selected leads. Body: { action, leadIds, ... }
//   assign      { ownerUserId?, teamId?, reason?, moveOpenActivities?, requestKey? } — needs crm.leads.bulk_assign
//   stage       { stage }
//   disqualify  { reason, notes? }
//   convert     { expectedCloseDate, owner?: { mode, userId?, userIds? }, pipelineId?, overrideReason? } — CRM plan 5.4
// Each lead succeeds or fails on its own; the response lists every outcome.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session, snapshot }) => {
    const context = crmContext(session, snapshot);
    const { action, ...input } = await readBody(request);
    const payload = input as { leadIds: string[] } & Record<string, unknown>;
    if (action === "assign") return ok(await bulkAssignLeads(client, context, payload));
    if (action === "stage") return ok(await bulkChangeLeadStage(client, context, payload as { leadIds: string[]; stage: string }));
    if (action === "disqualify") return ok(await bulkDisqualifyLeads(client, context, payload as { leadIds: string[]; reason: string }));
    if (action === "convert") return ok(await bulkConvertLeads(client, context, payload as Parameters<typeof bulkConvertLeads>[2]));
    throw new HttpError(400, "Unknown bulk action.");
  });
}
