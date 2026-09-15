import { getCrmReport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// getCrmReport only ever reads filters.from/filters.to (verified by reading
// its body) — ownerId/stageId/sourceId/campaignId/period were previously
// accepted here and silently dropped by the backend, which would have
// misled a caller into thinking that filtering worked. Only forward what
// the backend actually honors.
const FILTER_KEYS = ["from", "to"] as const;

// F030. Row/field scope, aggregation security and time basis are
// getCrmReport's own authority for each of its ~14 report kinds (pipeline,
// conversion, sources, activities, forecast, campaigns, revenue-
// operations, account-health, privacy, pipeline-intelligence, engagement-
// intelligence, relationship-coverage, partner-pipeline, ai-governance) —
// this route only forwards the report key and filters. getCrmReport does
// not check crm.reports.view internally, so this route enforces it.
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
    const result = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.reportsView);
      return getCrmReport(client, crmContext(session), report, filters);
    });
    return ok({ report: result });
  } catch (error) {
    return errorResponse(error);
  }
}
