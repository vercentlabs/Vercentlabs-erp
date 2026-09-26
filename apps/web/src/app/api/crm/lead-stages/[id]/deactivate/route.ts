import { deactivateLeadStageWithMigration } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// Fails closed with CRM_LEAD_STAGE_HAS_ACTIVE_LEADS (+ affectedCount) if
// active Leads remain on the stage and no migrateToStageId was given —
// the UI must surface that count and let the operator choose a
// replacement stage rather than silently stranding those Leads.
export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { migrateToStageId?: string };
    const result = await deactivateLeadStageWithMigration(client, crmContext(session), id, { migrateToStageId: body.migrateToStageId });
    return ok(result);
  });
}
