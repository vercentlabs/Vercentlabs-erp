import {
  allocateAcquisitionCosts, createCwipProject, decideCapitalizationAdjustment, getAcquisitionExceptions, getAcquisitionOverview, getAcquisitionReconciliation, getCapitalizationHistory, getCapitalizationReport,
  listCapitalizationAdjustments, listCapitalizations, listCostPending, listCostSources, listCwipProjects, listPurchasesToRegister, previewCapitalization, recordAcquisitionReturn, requestCapitalization,
  requestCapitalizationAdjustment, reverseCostAllocation, setDepreciationStart,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET overview · purchases (?search=) · cost-pending · requests (?status=review|approved|posted|rejected|all) · adjustments (?status=pending) · cwip · reconciliation · exceptions
//     · cost-sources (?search=) · report (?kind=) · history (?assetId=)
// POST allocate { component, sourceType, sourceLineId?, assetIds?|cwipId?, amount?, method, shares?, reason?, commandId? } · reverse-allocation { componentId, reason } · preview { assetId|cwipId }
//      · request { assetId|cwipId, capitalizationDate, availableForUseDate?, depreciationStartDate?, note? } · cwip-create { name, description?, categoryId?, cwipAccountId? }
//      · adjustment-request { assetId, kind, sourceLineId?, amount?, offsetAccountId?, reason, evidence?, commandId? } · adjustment-decide { adjustmentId, decision, note? }
//      · depreciation-start { assetId, date } · return { assetId, reason }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "overview": return getAcquisitionOverview(client, context);
      case "purchases": return listPurchasesToRegister(client, context, { search: get("search") });
      case "cost-pending": return listCostPending(client, context);
      case "requests": return listCapitalizations(client, context, { status: get("status") });
      case "adjustments": return listCapitalizationAdjustments(client, context, { status: get("status") });
      case "cwip": return listCwipProjects(client, context);
      case "reconciliation": return getAcquisitionReconciliation(client, context);
      case "exceptions": return { rows: await getAcquisitionExceptions(client, context) };
      case "cost-sources": return listCostSources(client, context, { search: get("search") });
      case "report": return { rows: await getCapitalizationReport(client, context, get("kind") ?? "purchases-pending-registration") };
      case "history": return { rows: await getCapitalizationHistory(client, context, { assetId: get("assetId") }) };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "allocate": return allocateAcquisitionCosts(client, context, input);
      case "reverse-allocation": return reverseCostAllocation(client, context, String(input.componentId ?? ""), input);
      case "preview": return previewCapitalization(client, context, input);
      case "request": return requestCapitalization(client, context, input);
      case "cwip-create": return createCwipProject(client, context, input);
      case "adjustment-request": return requestCapitalizationAdjustment(client, context, String(input.assetId ?? ""), input);
      case "adjustment-decide": return decideCapitalizationAdjustment(client, context, String(input.adjustmentId ?? ""), input);
      case "depreciation-start": return setDepreciationStart(client, context, String(input.assetId ?? ""), input);
      case "return": return recordAcquisitionReturn(client, context, String(input.assetId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
