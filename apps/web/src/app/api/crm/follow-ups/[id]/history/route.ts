import { listCrmFollowUpHistory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F016 Stage A2 §7. listCrmFollowUpHistory already existed with no
// frontend consumer — covers "escalation history" (escalateOverdueFollowUps
// writes an 'escalated' event into the same ledger) alongside the rest of
// the Follow-up's lifecycle events.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listCrmFollowUpHistory(client, crmContext(session), id);
    return ok({ rows });
  });
}
