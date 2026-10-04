import { startQualification } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { type LeadRouteParams } from "@/features/crm/leads/server/lead-http";

// Start Qualification: marks the lead as being qualified and moves it to the
// Qualification stage.
export async function POST(request: Request, route: LeadRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsEdit, billingWrite: true }, async ({ client, session }) =>
    ok(await startQualification(client, crmContext(session), (await route.params).id)),
  );
}
