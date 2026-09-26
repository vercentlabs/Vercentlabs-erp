import { deactivateSalesStageWithMigration } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F012 gap-closure — mirrors lead-stages/[id]/deactivate/route.ts exactly.
// Fails closed with CRM_SALES_STAGE_OPEN_OPPORTUNITIES (+ affectedCount) if
// open Opportunities remain on the stage and no migrateToStageId was given
// — the UI must surface that count and let the operator choose a
// replacement stage rather than silently stranding those deals.
export async function POST(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as { migrateToStageId?: string; expectedUpdatedAt?: string };
    const result = await deactivateSalesStageWithMigration(client, crmContext(session), id, {
      migrateToStageId: body.migrateToStageId,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });
    return ok(result);
  });
}
