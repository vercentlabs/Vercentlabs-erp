import { listRemindersForActivity } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F016 Stage A2 §7. listRemindersForActivity (follow-up-operations.js)
// already existed, fully tested (crm-follow-ups-f016.test.mjs), with no
// frontend consumer — delivery status (pending/dispatching/sent/failed/
// acknowledged) and failure_reason are real, already-tracked columns.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.activitiesManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const rows = await listRemindersForActivity(client, crmContext(session), id);
    return ok({ rows });
  });
}
