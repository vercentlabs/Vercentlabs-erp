import { listRemindersForActivity } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F016. listRemindersForActivity (follow-up-operations.js; see
// crm-follow-ups-f016.test.mjs) — delivery status (pending/dispatching/
// sent/failed/acknowledged) and failure_reason are real, tracked columns.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.activitiesManage },
    async ({ client, session }) => {
      const { id } = await context.params;
      const rows = await listRemindersForActivity(
        client,
        crmContext(session),
        id,
      );
      return ok({ rows });
    },
  );
}
