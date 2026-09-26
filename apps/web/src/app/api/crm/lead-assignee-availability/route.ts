import { listLeadAssigneeAvailability, setLeadAssigneeAvailability } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F005 gap-closure — listLeadAssigneeAvailability/setLeadAssigneeAvailability
// (assignment/availability.js) already existed and are already consulted by
// the live engine for automatic assignment (never for a manual override);
// there was previously no route or screen exposing either.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const rows = await listLeadAssigneeAvailability(client, crmContext(session));
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await setLeadAssigneeAvailability(client, crmContext(session), input);
    return ok({ record }, 201);
  });
}
