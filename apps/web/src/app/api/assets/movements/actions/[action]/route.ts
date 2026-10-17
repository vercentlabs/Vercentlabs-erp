import {
  decideMovementCorrection, getAssetMovementCorrections, getAssetMovementHistory, getAssetPositionAsOf, getMovementExceptions, getMovementReport, rebuildAssetMovementProjection,
  reconcileAssetMovementHistory, resolveMovementIssue,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET asset (?assetId=&eventType=&from=&to=) · as-of (?assetId=&date=&mode=EFFECTIVE|KNOWN) · exceptions · corrections (?status=) · report (?kind=&asOf=)
// POST reconcile { assetId? } · rebuild { assetId? } · decide-correction { correctionId, decision, note? } · resolve-issue { issueId, resolution }
type Params = { params: Promise<{ action: string }> };
export async function GET(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  const url = new URL(request.url);
  const get = (name: string) => url.searchParams.get(name) ?? undefined;
  return assetsRead(request, async (client, context) => {
    switch (action) {
      case "asset": return getAssetMovementHistory(client, context, get("assetId") ?? "", { eventType: get("eventType"), from: get("from"), to: get("to"), locationId: get("locationId") });
      case "as-of": return getAssetPositionAsOf(client, context, get("assetId") ?? "", { date: get("date"), mode: get("mode") });
      case "exceptions": return getMovementExceptions(client, context);
      case "corrections": return { rows: await getAssetMovementCorrections(client, context, { status: get("status") }) };
      case "report": return getMovementReport(client, context, get("kind") ?? "complete-history", { asOf: get("asOf") });
      default: throw new HttpError(404, "Unknown view.", "NOT_FOUND");
    }
  });
}
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "reconcile": return reconcileAssetMovementHistory(client, context, input);
      case "rebuild": return rebuildAssetMovementProjection(client, context, input);
      case "decide-correction": return decideMovementCorrection(client, context, String(input.correctionId ?? ""), input);
      case "resolve-issue": return resolveMovementIssue(client, context, String(input.issueId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
