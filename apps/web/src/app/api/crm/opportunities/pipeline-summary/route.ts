import { listOpportunityPipelineStageTotals, listOpportunityStageAges, listOpportunityStageBottlenecks } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F010 gap-closure — the Pipeline board previously derived its per-stage
// totals and "idle days" badges entirely client-side from whatever page of
// Opportunities it happened to fetch (capped at 200 rows, using the mutable
// updatedAt column with a hardcoded 30-day threshold). This route exposes
// the authoritative, already-governed aggregates (stage-aging.js) so the
// board can show the real number regardless of how many open Opportunities
// a stage holds, and the real per-Opportunity SLA status instead of a
// client-side approximation.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get("pipelineId");
    if (!pipelineId) throw new HttpError(400, "pipelineId is required.");
    const context = crmContext(session);
    const [stageTotals, stageAges, bottlenecks] = await Promise.all([
      listOpportunityPipelineStageTotals(client, context, pipelineId),
      listOpportunityStageAges(client, context, pipelineId),
      listOpportunityStageBottlenecks(client, context, pipelineId),
    ]);
    const result = await { stageTotals, stageAges, bottlenecks };
    return ok(result);
  });
}
