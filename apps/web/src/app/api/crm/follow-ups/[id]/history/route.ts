import { listCrmFollowUpHistory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F016 Stage A2 §7. listCrmFollowUpHistory already existed with no
// frontend consumer — covers "escalation history" (escalateOverdueFollowUps
// writes an 'escalated' event into the same ledger) alongside the rest of
// the Follow-up's lifecycle events.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listCrmFollowUpHistory(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
