import { findApplicableTransitionReasons, getCrmRecord, getLeadStage } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F007: which reason codes are valid for the specific from-stage -> to-
// stage move being attempted, resolved server-side from the Lead's actual
// current stage rather than trusting a client-supplied "from" value.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const toStageId = url.searchParams.get("toStageId");
    if (!toStageId) throw new HttpError(400, "A destination stage is required.");
    const ctx = crmContext(session);
    const lead = await getCrmRecord(client, ctx, "leads", id);
    const fromStage = await getLeadStage(client, ctx, lead.status);
    const reasons = await findApplicableTransitionReasons(client, ctx, fromStage.id, toStageId);
    return ok({ reasons });
  });
}
