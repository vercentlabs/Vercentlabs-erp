import { z } from "zod";

// Production Hold request bodies (the domain checks everything again).
const key = z.string().trim().min(1).max(200).optional();
export const REASON_CODES = ["MATERIAL_SHORTAGE", "QUALITY_FAILURE", "EQUIPMENT_BREAKDOWN", "SAFETY_CONCERN", "WORKFORCE_UNAVAILABLE", "CUSTOMER_CHANGE", "PRODUCTION_PRIORITY",
  "EXCESS_CONSUMPTION", "INVENTORY_DISCREPANCY", "COSTING_EXCEPTION", "OTHER"] as const;
export const holdSchema = z.object({
  reasonCode: z.enum(REASON_CODES), severity: z.enum(["NORMAL", "HIGH", "CRITICAL"]).optional(), description: z.string().max(2000),
  sourceType: z.enum(["MATERIAL_SHORTAGE", "QUALITY_INSPECTION", "QUALITY_HOLD", "EQUIPMENT_INCIDENT", "SAFETY_INCIDENT", "SALES_DEMAND", "OTHER"]).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(), sourceReference: z.string().max(200).nullable().optional(), affectedMaterialIds: z.array(z.string().uuid()).max(100).optional(),
  holdOwnerId: z.string().uuid().nullable().optional(), affectedLocationId: z.string().uuid().nullable().optional(), expectedResolutionAt: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(), expectedMoVersion: z.number().int().optional(), holdId: z.string().uuid().optional(), idempotencyKey: key,
});
export const resumeSchema = z.object({
  productionHoldId: z.string().uuid().optional(), resolutionNotes: z.string().max(2000).optional(), note: z.string().max(2000).optional(), expectedMoVersion: z.number().int().optional(),
  proceedWithShortages: z.boolean().optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(), idempotencyKey: key,
});
export const reasonActionSchema = z.object({
  resolutionNotes: z.string().max(2000).optional(), evidence: z.string().max(1000).nullable().optional(), correctiveAction: z.string().max(2000).optional(), idempotencyKey: key,
});
