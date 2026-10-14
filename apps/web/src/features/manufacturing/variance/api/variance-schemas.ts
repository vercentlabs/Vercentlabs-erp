import { z } from "zod";

// Material Consumption Variance request bodies (the domain checks everything again).
const key = z.string().trim().min(1).max(200).optional();
const reason = z.enum(["PROCESS_WASTE", "MATERIAL_DAMAGE", "QUALITY_REJECTION", "REWORK", "OPERATOR_ERROR", "MEASUREMENT_ERROR", "BOM_STANDARD_INACCURATE", "PRODUCTION_PLAN_CHANGE",
  "MISSING_CONSUMPTION", "OTHER"]);
export const openExceptionSchema = z.object({
  manufacturingOrderId: z.string().uuid(), materialId: z.string().uuid(), reasonCode: reason.nullable().optional(), explanation: z.string().max(2000).nullable().optional(),
  evidence: z.string().max(1000).nullable().optional(), assignedTo: z.string().uuid().nullable().optional(), idempotencyKey: key,
});
export const updateExceptionSchema = z.object({
  reasonCode: reason.nullable().optional(), explanation: z.string().max(2000).nullable().optional(), evidence: z.string().max(1000).nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(), expectedVersion: z.number().int().optional(),
});
export const exceptionActionSchema = z.object({
  reasonCode: reason.optional(), explanation: z.string().max(2000).optional(), expectedVersion: z.number().int().optional(),
  decision: z.enum(["APPROVE", "REJECT", "MORE_EVIDENCE"]).optional(), note: z.string().max(2000).optional(), reason: z.string().max(1000).optional(),
  resolutionType: z.enum(["AUTHORIZED_VARIANCE", "SOURCE_CORRECTED", "WITHIN_TOLERANCE", "EXTRA_MATERIAL", "PRODUCTION_HOLD", "BOM_REVIEW", "OTHER"]).optional(),
  referenceId: z.string().uuid().nullable().optional(), placeHold: z.boolean().optional(), quantity: z.union([z.string(), z.number()]).transform((value) => String(value)).optional(), idempotencyKey: key,
});
const amount = z.union([z.string(), z.number(), z.null()]).transform((value) => (value === null ? null : String(value))).optional();
export const toleranceSchema = z.object({
  scope: z.enum(["ITEM", "GROUP"]), itemId: z.string().uuid().nullable().optional(), itemGroupId: z.string().uuid().nullable().optional(), warningPct: amount, approvalPct: amount,
  savingReviewPct: amount, approvalValueAbove: amount, approvalQuantityAbove: amount, critical: z.boolean().optional(), notes: z.string().max(500).nullable().optional(),
});
