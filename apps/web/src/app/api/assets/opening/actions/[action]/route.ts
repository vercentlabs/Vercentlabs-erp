import {
  correctOpeningPosition, createManualOpeningAsset, getOpeningExceptions, getOpeningHistory, getOpeningOverview, getOpeningReconciliation, getOpeningReport, listOpeningBatches, updateOpeningPosition,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET overview · batches (?status=open|finance|completed|all) · exceptions · history (?batchId=) · reconciliation (?batchId=) · report (?kind=)
// POST manual { cutoverDate, …one asset's template fields, idempotencyKey? } · position-update { positionId, …values, reason } · position-correct { positionId, …values, reason, evidence }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "overview": return getOpeningOverview(client, context);
      case "batches": return listOpeningBatches(client, context, { status: get("status") });
      case "exceptions": return { rows: await getOpeningExceptions(client, context) };
      case "history": return { rows: await getOpeningHistory(client, context, get("batchId")) };
      case "reconciliation": return getOpeningReconciliation(client, context, get("batchId") ?? "");
      case "report": return { rows: await getOpeningReport(client, context, get("kind") ?? "opening-register") };
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "manual": return createManualOpeningAsset(client, context, input);
      case "position-update": return updateOpeningPosition(client, context, String(input.positionId ?? ""), input);
      case "position-correct": return correctOpeningPosition(client, context, String(input.positionId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
