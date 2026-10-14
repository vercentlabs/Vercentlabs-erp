import { z } from "zod";

// Finished-Goods Receipt request bodies (the domain checks everything again).
const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
export const receiptLineSchema = z.object({
  productionEntryId: z.string().uuid(), quantity, uomId: z.string().uuid().optional(), lotNumber: z.string().max(120).nullable().optional(), manufacturedOn: day, expiresOn: day,
  serialNumbers: z.union([z.array(z.string().max(120)).max(500), z.string().max(60000)]).nullable().optional(),
});
export const receiptDraftSchema = z.object({
  manufacturingOrderId: z.string().uuid(), destinationWarehouseId: z.string().uuid().optional(), destinationLocationId: z.string().uuid().nullable().optional(),
  sourceLocationId: z.string().uuid().nullable().optional(), receiptDate: day, notes: z.string().max(1000).optional(), lines: z.array(receiptLineSchema).max(200),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const receiptEditSchema = receiptDraftSchema.omit({ manufacturingOrderId: true, idempotencyKey: true }).partial().extend({ expectedVersion: z.number().int().optional() });
export const receiptActionSchema = z.object({
  expectedVersion: z.number().int().optional(), expectedMoVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
  reason: z.string().max(1000).optional(), note: z.string().max(1000).optional(), evidence: z.string().max(1000).optional(), decision: z.enum(["APPROVE", "REJECT"]).optional(),
});
