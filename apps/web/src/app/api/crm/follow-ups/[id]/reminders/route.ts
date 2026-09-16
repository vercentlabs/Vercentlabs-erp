import { listRemindersForActivity } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F016 Stage A2 §7. listRemindersForActivity (follow-up-operations.js)
// already existed, fully tested (crm-follow-ups-f016.test.mjs), with no
// frontend consumer — delivery status (pending/dispatching/sent/failed/
// acknowledged) and failure_reason are real, already-tracked columns.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listRemindersForActivity(client, crmContext(session), id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
