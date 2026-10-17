import {
  configureDepreciationAutomation, disableAutomaticDepreciationPosting, enableAutomaticDepreciationPosting, getDepreciationAutomationAudit, getDepreciationAutomationReport, getDepreciationExecution,
  getDepreciationJournalPreview, listDepreciationExecutions, retryDepreciationExecution, triggerDepreciationAutomation, validateAutomationReadiness,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET executions (?view=) · execution (?id=) · readiness · audit · report (?kind=) · journal-preview (?runId=)
// POST configure { mode, triggerDaysAfterPeriodEnd?, closeDeadlineDays?, firstPeriod?, notifyFinance?, reason } · enable { reason } · disable { reason, mode? } · run { period? } · retry { executionId }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "executions": return listDepreciationExecutions(client, context, { view: get("view") });
      case "execution": return getDepreciationExecution(client, context, get("id") ?? "");
      case "readiness": return validateAutomationReadiness(client, context);
      case "audit": return getDepreciationAutomationAudit(client, context);
      case "report": return getDepreciationAutomationReport(client, context, get("kind") ?? "run-history");
      case "journal-preview": return getDepreciationJournalPreview(client, context, get("runId") ?? "");
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "configure": return configureDepreciationAutomation(client, context, input);
      case "enable": return enableAutomaticDepreciationPosting(client, context, input);
      case "disable": return disableAutomaticDepreciationPosting(client, context, input);
      case "run": return triggerDepreciationAutomation(client, context, input);
      case "retry": return retryDepreciationExecution(client, context, String(input.executionId ?? ""));
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
