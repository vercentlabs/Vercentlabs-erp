import { z } from "zod";

// Production Quality Inspection request bodies (the domain checks everything again).
const quantity = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalQuantity = z.union([z.string(), z.number(), z.null()]).transform((value) => (value === null ? null : String(value))).optional();
const list = z.union([z.array(z.string().max(80)).max(30), z.string().max(1000)]);
export const criterionSchema = z.object({
  key: z.string().max(60).optional(), name: z.string().min(1).max(200), type: z.enum(["PASS_FAIL", "NUMERIC", "TEXT", "CHOICE"]), unit: z.string().max(20).nullable().optional(),
  lower: z.union([z.string(), z.number(), z.null()]).optional(), upper: z.union([z.string(), z.number(), z.null()]).optional(), choices: list.optional(), acceptedChoices: list.optional(),
  required: z.boolean().optional(), critical: z.boolean().optional(), instructions: z.string().max(500).nullable().optional(),
});
export const templateSchema = z.object({
  name: z.string().min(1).max(160), finishedItemId: z.string().uuid().nullable().optional(), inspectionStage: z.enum(["FINAL", "IN_PROCESS"]).optional(),
  criteria: z.array(criterionSchema).max(100), notes: z.string().max(1000).nullable().optional(),
});
export const revisionSchema = z.object({ criteria: z.array(criterionSchema).max(100), notes: z.string().max(1000).nullable().optional() });
export const templateStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });
export const inspectionDraftSchema = z.object({
  manufacturingOrderId: z.string().uuid(), productionEntryId: z.string().uuid(), inspectionStage: z.enum(["FINAL", "IN_PROCESS"]).optional(), quantity, uomId: z.string().uuid().nullable().optional(),
  examinedQuantity: optionalQuantity, productionLocationId: z.string().uuid().nullable().optional(), inspectedAt: z.string().max(40).optional(), notes: z.string().max(2000).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const inspectionRecordSchema = z.object({
  expectedVersion: z.number().int().optional(),
  results: z.array(z.object({
    key: z.string().min(1).max(60), value: z.union([z.string().max(500), z.number(), z.null()]).transform((value) => (value === null ? null : String(value))),
    notes: z.string().max(1000).nullable().optional(),
  })).max(100).optional(),
  defects: z.array(z.object({
    reasonCode: z.string().min(1).max(80), severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]), affectedQuantity: quantity, observation: z.string().max(1000).nullable().optional(),
  })).max(50).optional(),
  acceptedQuantity: optionalQuantity, rejectedQuantity: optionalQuantity, holdQuantity: optionalQuantity, examinedQuantity: optionalQuantity,
  rejectionReason: z.string().max(1000).nullable().optional(), rejectionDisposition: z.enum(["QUARANTINE", "REWORK", "SCRAP"]).nullable().optional(),
  reworkAssignedTo: z.string().max(200).nullable().optional(), holdReason: z.string().max(1000).nullable().optional(), deviationRequested: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export const inspectionActionSchema = z.object({
  expectedVersion: z.number().int().optional(), expectedEntryVersion: z.number().int().optional(), decision: z.enum(["APPROVE", "RETURN"]).optional(),
  note: z.string().max(1000).optional(), reason: z.string().max(1000).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const holdSchema = z.object({
  productionEntryId: z.string().uuid(), quantity, uomId: z.string().uuid().nullable().optional(), reason: z.string().max(1000), idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export const holdActionSchema = z.object({ note: z.string().max(1000).optional(), notes: z.string().max(2000).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export const correctionSchema = z.object({
  productionEntryId: z.string().uuid(), direction: z.enum(["ACCEPTED_TO_REJECTED", "REJECTED_TO_ACCEPTED"]), kind: z.enum(["REVIEW", "REWORK"]).optional(), quantity, uomId: z.string().uuid().nullable().optional(),
  reason: z.string().max(1000), evidence: z.string().max(1000).nullable().optional(), rejectionDisposition: z.enum(["QUARANTINE", "REWORK", "SCRAP"]).nullable().optional(),
  inspectionId: z.string().uuid().nullable().optional(), idempotencyKey: z.string().trim().min(1).max(200),
});
