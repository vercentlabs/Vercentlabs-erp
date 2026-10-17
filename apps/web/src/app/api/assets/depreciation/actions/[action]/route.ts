import {
  approveDepreciationBasis, bulkGenerateDepreciationSchedules, getDueDepreciationLines, listDepreciationSchedules, rebuildDepreciationSchedules, createDepreciationPolicy, deactivateDepreciationPolicy, getDepreciationExceptions, getDepreciationHistory, getDepreciationOverview,
  getDepreciationReport, listDepreciableAssets, listDepreciationPolicies, listDepreciationRuns, listEstimateChanges, prepareDepreciationRun, reconcileDepreciation, rejectDepreciationBasis, reviseDepreciationPolicy,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET overview · assets (?view=&search=) · schedules (?view=&search=&categoryId=&postingState=) · due (?period=) · policies (?all=) · runs (?view=) · estimate-changes · exceptions · reconciliation (?runId=) · report (?kind=&assetId=) · history (?assetId=&runId=)
// POST rebuild-schedules { assetId? } · policy-create · policy-revise { policyId, … } · policy-deactivate { policyId, reason } · bulk-generate · run-prepare { period, idempotencyKey } · basis-approve { basisId, note? } · basis-reject { basisId, reason }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "overview": return getDepreciationOverview(client, context);
      case "assets": return listDepreciableAssets(client, context, { view: get("view"), search: get("search") });
      case "policies": return listDepreciationPolicies(client, context, { all: get("all") });
      case "runs": return listDepreciationRuns(client, context, { view: get("view") });
      case "schedules": return listDepreciationSchedules(client, context, { view: get("view"), search: get("search"), categoryId: get("categoryId"), postingState: get("postingState") });
      case "due": return getDueDepreciationLines(client, context, { period: get("period") });
      case "estimate-changes": return listEstimateChanges(client, context);
      case "exceptions": return { rows: await getDepreciationExceptions(client, context) };
      case "reconciliation": return reconcileDepreciation(client, context, { runId: get("runId") });
      case "report": return getDepreciationReport(client, context, get("kind") ?? "asset-schedule", { assetId: get("assetId") });
      case "history": return { rows: await getDepreciationHistory(client, context, { assetId: get("assetId"), runId: get("runId") }) };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "policy-create": return createDepreciationPolicy(client, context, input);
      case "policy-revise": return reviseDepreciationPolicy(client, context, String(input.policyId ?? ""), input);
      case "policy-deactivate": return deactivateDepreciationPolicy(client, context, String(input.policyId ?? ""), input);
      case "bulk-generate": return bulkGenerateDepreciationSchedules(client, context);
      case "rebuild-schedules": return rebuildDepreciationSchedules(client, context, input);
      case "run-prepare": return prepareDepreciationRun(client, context, input);
      case "basis-approve": return approveDepreciationBasis(client, context, String(input.basisId ?? ""), input);
      case "basis-reject": return rejectDepreciationBasis(client, context, String(input.basisId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
