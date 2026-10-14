import { z } from "zod";

// Manufacturing Scrap request bodies (the domain checks everything again).
const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
export const scrapLineSchema = z.object({
  materialId: z.string().uuid().optional(), productionEntryId: z.string().uuid().optional(), quantity, uomId: z.string().uuid().optional(), batchId: z.string().uuid().nullable().optional(),
  serialIds: z.array(z.string().uuid()).max(500).optional(), notes: z.string().max(500).nullable().optional(),
});
const header = {
  reasonCode: z.enum(["DAMAGED_DURING_PRODUCTION", "MANUFACTURING_DEFECT", "CONTAMINATION", "PROCESS_LOSS", "MACHINE_FAILURE", "HANDLING_DAMAGE", "EXPIRED", "QUALITY_REJECTION", "OTHER"]),
  description: z.string().max(1000).nullable().optional(), disposition: z.enum(["IRRECOVERABLE", "RECOVERABLE"]).optional(), lossClass: z.enum(["NORMAL", "ABNORMAL"]).optional(),
  destinationLocationId: z.string().uuid().nullable().optional(), recoveryValue: z.union([z.string(), z.number()]).nullable().optional(),
  scrapDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), lines: z.array(scrapLineSchema).max(200),
};
export const scrapDraftSchema = z.object({
  manufacturingOrderId: z.string().uuid(), scrapType: z.enum(["ISSUED_MATERIAL", "REJECTED_OUTPUT"]), ...header, idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const scrapEditSchema = z.object(header).partial().extend({ expectedVersion: z.number().int().optional() });
export const scrapActionSchema = z.object({
  expectedVersion: z.number().int().optional(), expectedMoVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(1000).optional(), note: z.string().max(1000).optional(), evidence: z.string().max(1000).optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(),
  physicallyPresent: z.boolean().optional(),
});
