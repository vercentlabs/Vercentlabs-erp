import { z } from "zod";

import {
  activateBomRevision, approveBomRevision, cancelBomSchedule, discardBomDraft, duplicateManufacturingBom, estimateBomCost, exportBomRevision, getBomRevisionImpact, handOffBomShortages,
  obsoleteBomRevision, previewBomAvailability, previewBomRequirements, rejectBomRevision, scheduleBomRevision, submitBomRevision, validateBomRevision, withdrawBomRevision,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET impact: what activating this revision would change (?plannedQuantity=&warehouseId= for the material and cost effect).
// GET availability: can this revision be made now (?plannedQuantity=&warehouseId=&policy=) — read only, no order needed.
export async function GET(request: Request, ctx: { params: Promise<{ bomId: string; revisionId: string; action: string }> }) {
  const { revisionId, action } = await ctx.params;
  const url = new URL(request.url);
  return manufacturingRead(request, async (client, context) => {
    if (action === "availability") {
      return { availability: await previewBomAvailability(client, context, revisionId, { plannedQuantity: url.searchParams.get("plannedQuantity") || "1",
        warehouseId: url.searchParams.get("warehouseId") || undefined, policy: url.searchParams.get("policy") || undefined }) };
    }
    if (action !== "impact") throw new HttpError(404, "Unknown BOM revision view.", "NOT_FOUND");
    return { impact: await getBomRevisionImpact(client, context, revisionId, { plannedQuantity: url.searchParams.get("plannedQuantity") || undefined,
      warehouseId: url.searchParams.get("warehouseId") || undefined }) };
  });
}

// validate · submit · withdraw · approve · reject · schedule · activate · cancel-schedule · obsolete · discard · duplicate · requirements-preview ·
// cost-preview · shortages (hand to Procurement as demand) · export. Every action checks its own BOM permission in the domain.
const schema = z.object({
  expectedVersion: z.number().int().optional(), contentHash: z.string().max(100).optional(), note: z.string().max(1000).optional(), reason: z.string().max(1000).optional(),
  effectiveFrom: z.string().max(40).optional(), effectiveTo: z.string().max(40).nullable().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  finishedItemId: z.string().uuid().optional(), name: z.string().max(200).optional(),
  plannedQuantity: z.union([z.string(), z.number()]).optional(), uomId: z.string().uuid().optional(), warehouseId: z.string().uuid().nullable().optional(),
  policy: z.enum(["MANUFACTURE_REQUIRED_SUBASSEMBLIES", "USE_STOCKED_SUBASSEMBLIES"]).optional(),
  choices: z.record(z.string(), z.union([z.enum(["MAKE", "USE_STOCK"]), z.object({ useFromStock: z.union([z.string(), z.number()]) })])).optional(),
  requestKey: z.string().max(200).optional(), requiredBy: z.string().max(10).optional(), itemIds: z.array(z.string().uuid()).optional(), notes: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ bomId: string; revisionId: string; action: string }> }) {
  const { revisionId, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    const plan = { ...input, warehouseId: input.warehouseId ?? undefined };
    switch (action) {
      case "validate": return { validation: await validateBomRevision(client, context, revisionId) };
      case "submit": return { bom: await submitBomRevision(client, context, revisionId, input) };
      case "withdraw": return { bom: await withdrawBomRevision(client, context, revisionId) };
      case "approve": return { bom: await approveBomRevision(client, context, revisionId, input) };
      case "reject": return { bom: await rejectBomRevision(client, context, revisionId, input) };
      case "schedule":
        if (!input.effectiveFrom) throw new HttpError(400, "Choose when the revision takes effect.", "VALIDATION_FAILED");
        return { bom: await scheduleBomRevision(client, context, revisionId, input) };
      case "activate": return { bom: await activateBomRevision(client, context, revisionId, input) };
      case "cancel-schedule": return { bom: await cancelBomSchedule(client, context, revisionId, input) };
      case "obsolete": return { bom: await obsoleteBomRevision(client, context, revisionId, input) };
      case "discard": return { result: await discardBomDraft(client, context, revisionId) };
      case "duplicate": return { bom: await duplicateManufacturingBom(client, context, revisionId, input) };
      case "requirements-preview": return { preview: await previewBomRequirements(client, context, revisionId, plan) };
      case "cost-preview": return { cost: await estimateBomCost(client, context, revisionId, plan) };
      case "shortages": return { handoff: await handOffBomShortages(client, context, revisionId, plan) };
      case "export": return { file: await exportBomRevision(client, context, revisionId) };
      default: throw new HttpError(404, "Unknown BOM action.", "NOT_FOUND");
    }
  });
}
