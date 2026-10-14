import { z } from "zod";

// Material Consumption request bodies (the domain checks everything again).
const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
export const consumptionLineSchema = z.object({
  materialId: z.string().uuid(), quantity, uomId: z.string().uuid().optional(), batchId: z.string().uuid().nullable().optional(), serialIds: z.array(z.string().uuid()).max(500).optional(),
  sourceMovementId: z.string().uuid().nullable().optional(), varianceReason: z.string().max(500).optional(), notes: z.string().max(500).optional(),
});
export const consumptionDraftSchema = z.object({
  manufacturingOrderId: z.string().uuid(), productionLocationId: z.string().uuid().nullable().optional(), productionEntryId: z.string().uuid().nullable().optional(),
  productionBatchReference: z.string().max(120).optional(), outputBasisQuantity: z.union([z.string(), z.number()]).nullable().optional(), consumedAt: z.string().max(40).nullable().optional(),
  supervisorUserId: z.string().uuid().nullable().optional(), notes: z.string().max(1000).optional(), lines: z.array(consumptionLineSchema).max(200),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const consumptionEditSchema = consumptionDraftSchema.omit({ manufacturingOrderId: true, idempotencyKey: true }).partial().extend({ expectedVersion: z.number().int().optional() });
export const consumptionActionSchema = z.object({
  expectedVersion: z.number().int().optional(), expectedMoVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(1000).optional(), note: z.string().max(1000).optional(), evidence: z.string().max(1000).optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(),
  lineId: z.string().uuid().optional(), quantity: z.union([z.string(), z.number()]).transform((value) => String(value)).optional(),
});
