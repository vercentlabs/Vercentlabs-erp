import { z } from "zod";

import {
  approveManufacturingOrder, cancelManufacturingOrder, completeManufacturingOrder, createSubassemblyOrder, decideManufacturingQuality, exportManufacturingOrder, getManufacturingOrderCosts,
  getManufacturingOrder, getManufacturingOrderHistory, handOffManufacturingShortages, holdManufacturingOrder, raiseManufacturingException, receiveManufacturedGoods,
  recordManufacturingConsumption, recordManufacturingProduction, releaseManufacturingOrder, releaseManufacturingReservations, requestExtraMaterial, reserveManufacturingMaterials,
  resumeManufacturingOrder, returnManufacturingMaterials, returnManufacturingOrder, startManufacturingProduction, submitManufacturingOrder, validateManufacturingOrder,
  checkBatchMaterialReadiness, createProductionBatch, createProductionEntryDraft, decideShortClose, getMoProductionProgress, getProductionHistory, getReceivableFinishedGoods,
  requestOverproduction, requestShortClose,
  getConsumableMoMaterials, getConsumptionReconciliation, getIssuableMoMaterials, getMaterialAvailability, listMaterialShortages, recordMaterialScrap, previewMaterialReservation, requestMaterialShortages, validateMaterialIssueReadiness,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET production (progress) · receivable-output · production-history · production-readiness (?quantity=) · costs · history · export · issuable-materials · consumable-materials (?outputQuantity= for the BOM's suggestion) · material-reconciliation · material-availability (?since=<inventory cursor>) · reservation-preview · material-shortage-requests
export async function GET(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const since = params.get("since");
  return manufacturingRead(request, async (client, context) => {
    switch (action) {
      case "production": return { production: await getMoProductionProgress(client, context, id) };
      case "receivable-output": return { receivable: await getReceivableFinishedGoods(client, context, id) };
      case "production-history": return { history: await getProductionHistory(client, context, id) };
      case "production-readiness": return { readiness: await checkBatchMaterialReadiness(client, context, id, { quantity: params.get("quantity") ?? undefined, uomId: params.get("uomId") ?? undefined }) };
      case "issuable-materials": return { issuable: await getIssuableMoMaterials(client, context, id) };
      case "consumable-materials": return { consumable: await getConsumableMoMaterials(client, context, id, { outputQuantity: params.get("outputQuantity") ?? undefined }) };
      case "material-reconciliation": return { reconciliation: await getConsumptionReconciliation(client, context, id) };
      case "material-availability": return { availability: await getMaterialAvailability(client, context, id, { since: since ?? undefined }) };
      case "reservation-preview": return { preview: await previewMaterialReservation(client, context, id) };
      case "material-shortage-requests": return { shortages: (await listMaterialShortages(client, context, {})).filter((row) => row.orderId === id) };
      case "costs": return { costs: await getManufacturingOrderCosts(client, context, id) };
      case "history": return { history: await getManufacturingOrderHistory(client, context, id) };
      case "export": return { file: await exportManufacturingOrder(client, context, id) };
      default: throw new HttpError(404, "Unknown manufacturing order view.", "NOT_FOUND");
    }
  });
}

const quantity = z.union([z.string(), z.number()]);
const schema = z.object({
  expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(), note: z.string().max(1000).optional(), reason: z.string().max(1000).optional(),
  category: z.string().max(40).optional(), reserveMaterials: z.boolean().optional(), allowPartial: z.boolean().optional(), itemIds: z.array(z.string().uuid()).optional(),
  itemId: z.string().uuid().optional(), requestKey: z.string().max(120).optional(), materialId: z.string().uuid().optional(), componentItemId: z.string().uuid().optional(),
  quantity: quantity.optional(), lines: z.array(z.object({ materialId: z.string().uuid(), quantity, batchId: z.string().uuid().nullable().optional(),
    serialIds: z.array(z.string().uuid()).max(500).optional(), reason: z.string().max(500).optional(), note: z.string().max(500).optional() })).max(200).optional(),
  reportedQuantity: quantity.optional(), acceptedQuantity: quantity.optional(), rejectedQuantity: quantity.optional(), pendingQuantity: quantity.optional(),
  rejectionReason: z.string().max(500).optional(), batchReference: z.string().max(120).optional(), notes: z.string().max(1000).optional(), entryId: z.string().uuid().optional(),
  disposition: z.enum(["QUARANTINE", "SCRAP", "REWORK"]).optional(), reasonCode: z.string().max(60).optional(), productionEntryId: z.string().uuid().optional(),
  productionBatchId: z.string().uuid().optional(), productionLocationId: z.string().uuid().nullable().optional(), uomId: z.string().uuid().optional(), producedAt: z.string().max(40).optional(),
  plannedQuantity: quantity.optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(), expectedEntryVersion: z.number().int().optional(), inspectionReference: z.string().max(120).optional(), batchNumber: z.string().max(120).optional(),
  expiresOn: z.string().max(10).optional(), serialNumbers: z.union([z.string().max(20000), z.array(z.string().max(120)).max(500)]).optional(),
  shortCloseReason: z.string().max(1000).optional(), consumeRemaining: z.boolean().optional(), materialIds: z.array(z.string().uuid()).max(200).optional(),
});

// validate · submit · return · approve · release · hold · resume · cancel · reserve-materials · release-reservations · (material-issues: its own route) ·
// material-returns · material-consumption · material-variances (request extra material) · start · production-entries · quality-decisions ·
// finished-goods-receipts · production-entry-drafts · production-batches · overproduction-requests · request-short-close · decide-short-close · complete · shortages / material-shortage-requests (net of what is already requested) · issue-readiness (moves nothing) · material-scrap (issued material declared unusable) ·
// subassembly-order · exceptions. Each checks its own permission in the domain.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "validate": return { validation: await validateManufacturingOrder(client, context, id) };
      case "submit": return { order: await submitManufacturingOrder(client, context, id, input) };
      case "return": return { order: await returnManufacturingOrder(client, context, id, input) };
      case "approve": return { order: await approveManufacturingOrder(client, context, id, input) };
      case "release": return { order: await releaseManufacturingOrder(client, context, id, input) };
      case "hold": return { order: await holdManufacturingOrder(client, context, id, input) };
      case "resume": return { order: await resumeManufacturingOrder(client, context, id, input) };
      case "cancel": return { order: await cancelManufacturingOrder(client, context, id, input) };
      case "reserve-materials": return await reserveManufacturingMaterials(client, context, id, input);
      case "release-reservations": return { order: await releaseManufacturingReservations(client, context, id, input) };
      case "material-returns": return await returnManufacturingMaterials(client, context, id, input);
      case "material-consumption": return { order: await recordManufacturingConsumption(client, context, id, input) };
      case "material-variances": return { order: await requestExtraMaterial(client, context, id, input) };
      case "start": return { order: await startManufacturingProduction(client, context, id, input) };
      case "production-entries": return await recordManufacturingProduction(client, context, id, input);
      case "production-entry-drafts": return { entry: await createProductionEntryDraft(client, context, id, input) };
      case "production-batches": return { batch: await createProductionBatch(client, context, id, input) };
      case "overproduction-requests": return await requestOverproduction(client, context, id, input);
      case "request-short-close": return { order: await requestShortClose(client, context, id, input) };
      case "decide-short-close": return { order: await decideShortClose(client, context, id, input) };
      case "quality-decisions": return await decideManufacturingQuality(client, context, id, input);
      case "finished-goods-receipts": return await receiveManufacturedGoods(client, context, id, input);
      case "complete": return { order: await completeManufacturingOrder(client, context, id, input) };
      case "shortages": return await handOffManufacturingShortages(client, context, id, input);
      case "material-shortage-requests": return await requestMaterialShortages(client, context, id, input);
      case "material-scrap":
        await recordMaterialScrap(client, context, id, input);
        return { order: await getManufacturingOrder(client, context, id) };
      case "issue-readiness": return { readiness: await validateMaterialIssueReadiness(client, context, id, input) };
      case "subassembly-order":
        if (!input.materialId) throw new HttpError(400, "Choose the subassembly to make.", "VALIDATION_FAILED");
        return { order: await createSubassemblyOrder(client, context, id, input.materialId, input) };
      case "exceptions": return { order: await raiseManufacturingException(client, context, id, input) };
      default: throw new HttpError(404, "Unknown manufacturing order action.", "NOT_FOUND");
    }
  });
}
