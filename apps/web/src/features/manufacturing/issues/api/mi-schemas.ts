import { z } from "zod";

// Material Issue request bodies (the domain checks everything again).
const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
export const issueLineSchema = z.object({
  materialId: z.string().uuid(), quantity, uomId: z.string().uuid().optional(), batchId: z.string().uuid().nullable().optional(),
  serialIds: z.array(z.string().uuid()).max(500).optional(), sourceLocationId: z.string().uuid().nullable().optional(), notes: z.string().max(500).optional(),
});
export const issueDraftSchema = z.object({
  manufacturingOrderId: z.string().uuid(), sourceWarehouseId: z.string().uuid().optional(), sourceLocationId: z.string().uuid().nullable().optional(),
  productionLocationId: z.string().uuid().nullable().optional(), issueReason: z.enum(["NORMAL", "EXTRA_MATERIAL", "REPLACEMENT", "CORRECTION"]).optional(),
  notes: z.string().max(1000).optional(), receivedBy: z.string().max(200).optional(), lines: z.array(issueLineSchema).max(200), idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const issueEditSchema = issueDraftSchema.omit({ manufacturingOrderId: true, idempotencyKey: true }).partial().extend({ expectedVersion: z.number().int().optional() });
export const issueActionSchema = z.object({
  expectedVersion: z.number().int().optional(), expectedMoVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(1000).optional(), note: z.string().max(1000).optional(), evidence: z.string().max(1000).optional(),
  varianceType: z.enum(["EXCESS_USAGE", "DAMAGED_DURING_PRODUCTION", "QUALITY_REPLACEMENT", "PLANNING_CORRECTION", "OTHER"]).optional(),
  decision: z.enum(["APPROVE", "REJECT"]).optional(), lineIds: z.array(z.string().uuid()).max(200).optional(),
});
