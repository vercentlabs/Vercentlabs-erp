import { getCrmReport } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

const FILTER_KEYS = ["ownerId", "stageId", "sourceId", "campaignId", "from", "to", "period"] as const;

// F030. Row/field scope, aggregation security and time basis are
// getCrmReport's own authority for each of its ~14 report kinds (pipeline,
// conversion, sources, activities, forecast, campaigns, revenue-
// operations, account-health, privacy, pipeline-intelligence, engagement-
// intelligence, relationship-coverage, partner-pipeline, ai-governance) —
// this route only forwards the report key and filters.
export async function GET(request: Request, context: { params: Promise<{ report: string }> }) {
  try {
    const session = await requireWorkspace();
    const { report } = await context.params;
    const url = new URL(request.url);
    const filters: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = url.searchParams.get(key);
      if (value) filters[key] = value;
    }
    const result = await withClient((client) => getCrmReport(client, crmContext(session), report, filters));
    return ok({ report: result });
  } catch (error) {
    return errorResponse(error);
  }
}
