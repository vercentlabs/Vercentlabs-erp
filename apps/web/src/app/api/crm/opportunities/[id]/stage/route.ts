import { moveOpportunityStage } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F010/F012/F026. A governed won/lost outcome reason travels through the
// same expectations bag moveOpportunityStage already accepts
// (outcomeReasonId/outcomeNotes) — no separate "won/lost" endpoint.
// moveOpportunityStage does not check a permission internally, so this
// route enforces crm.opportunities.manage itself.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true }, async ({ client, session }) => {
    const { id } = await context.params;
    const body = (await readJson(request)) as {
      stageId: string;
      note?: string | null;
      expectedUpdatedAt?: string;
      expectedStageId?: string | null;
      outcomeReasonId?: string | null;
      outcomeNotes?: string | null;
    };
    const record = await moveOpportunityStage(client, crmContext(session), id, body.stageId, body.note ?? null, {
      expectedUpdatedAt: body.expectedUpdatedAt,
      expectedStageId: body.expectedStageId,
      outcomeReasonId: body.outcomeReasonId,
      outcomeNotes: body.outcomeNotes,
    });
    return ok({ record });
  });
}
