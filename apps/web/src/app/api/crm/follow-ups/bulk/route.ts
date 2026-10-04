import { bulkUpdateFollowUps } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/follow-ups/server/follow-up-http";

// Body: { action: reassign | reschedule | cancel, followUpIds, assignedTo?, scheduledDate?, shiftDays?, reason? }. There is no bulk complete.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView, billingWrite: true }, async ({ client, session }) => ok(await bulkUpdateFollowUps(client, crmContext(session), await readBody(request))));
}
