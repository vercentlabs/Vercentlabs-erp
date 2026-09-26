import { getLeadAssignmentFallback, setLeadAssignmentFallback } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F005 gap-closure — getLeadAssignmentFallback/setLeadAssignmentFallback
// (assignment/availability.js) already existed and are already the row
// the live assignment engine reads last, after every policy has had its
// chance; there was previously no route or screen to configure it, so an
// admin's only option was writing SQL directly against the tenant DB.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const record = await getLeadAssignmentFallback(client, crmContext(session));
    return ok({ record });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as { userId?: string | null };
    const record = await setLeadAssignmentFallback(client, crmContext(session), body.userId ?? null);
    return ok({ record });
  });
}
