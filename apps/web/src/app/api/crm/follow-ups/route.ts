import { listFollowUps, scheduleFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, followUpFiltersFromUrl } from "@/features/crm/follow-ups/server/follow-up-http";

// The follow-ups the caller can see, for one view and set of filters.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView }, async ({ client, session }) => {
    const { followUps, ...page } = await listFollowUps(client, crmContext(session), followUpFiltersFromUrl(new URL(request.url)));
    return ok({ rows: followUps, ...page });
  });
}

// Body: { relatedType, relatedId, type?, subject?, notes?, contactId?, scheduledDate, scheduledTime?, reminderOffsetMinutes? | reminderAt?, assignedTo?, idempotencyKey? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.followUpsView, billingWrite: true }, async ({ client, session }) =>
    ok({ record: await scheduleFollowUp(client, crmContext(session), await readBody(request)) }, 201),
  );
}
