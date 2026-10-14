import {
  applyManufacturingCosts, finalizeManufacturingCosting, previewManufacturingCosts, previewReceiptCost, recordReconciliation, reestimateManufacturingCost, requestCostAdjustment,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET receipt-preview?quantity= (what a finished-goods receipt would carry now) · apply-preview (what applying labor and overhead would post).
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  if (action === "apply-preview") return manufacturingRead(request, async (client, context) => ({ preview: await previewManufacturingCosts(client, context, id) }));
  if (action !== "receipt-preview") return manufacturingRead(request, async () => { throw new HttpError(404, "Unknown costing view.", "NOT_FOUND"); });
  const quantity = new URL(request.url).searchParams.get("quantity") ?? "";
  return manufacturingRead(request, async (client, context) => ({ preview: await previewReceiptCost(client, context, id, quantity) }));
}

const schema = z.object({
  direction: z.enum(["WIP_TO_VARIANCE", "VARIANCE_TO_WIP"]).optional(), amount: z.union([z.string(), z.number()]).transform((value) => String(value)).optional(),
  reason: z.string().max(1000).optional(), evidence: z.string().max(1000).optional(), note: z.string().max(500).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  expectedMoVersion: z.number().int().optional(), includeReversals: z.boolean().optional(),
});

// apply-costs (labor and overhead due; with includeReversals and a reason, over-applied cost taken back) · estimate (a new version; the baseline stays) · reconcile (record a check against Finance) · finalize · adjustments (request one).
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "apply-costs": return applyManufacturingCosts(client, context, id, input);
      case "estimate": return reestimateManufacturingCost(client, context, id);
      case "reconcile": return recordReconciliation(client, context, id, input);
      case "finalize": return finalizeManufacturingCosting(client, context, id, input);
      case "adjustments": return requestCostAdjustment(client, context, id, input);
      default: throw new HttpError(404, "Unknown costing action.", "NOT_FOUND");
    }
  });
}
