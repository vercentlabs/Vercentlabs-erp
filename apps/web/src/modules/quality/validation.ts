import { z } from "zod";

const uuid = z.string().uuid();

export const qualityPlanCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  planType: z.enum([
    "incoming",
    "in_process",
    "final",
    "stock_audit",
    "supplier",
    "customer_return",
  ]),
  itemId: uuid.nullish(),
  itemGroupId: uuid.nullish(),
  supplierId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  manufacturingOperationSequence: z.coerce.number().int().positive().nullish(),
  version: z.coerce.number().int().positive().default(1),
  effectiveFrom: z.string().date().nullish(),
  effectiveTo: z.string().date().nullish(),
  samplingMethod: z
    .enum(["full", "fixed_quantity", "percentage", "aql"])
    .default("full"),
  samplingValue: z.coerce.number().min(0).default(100),
  points: z
    .array(
      z.object({
        characteristic: z.string().trim().min(1).max(300),
        inspectionMethod: z.string().trim().min(1).max(300),
        resultType: z.enum(["numeric", "boolean", "text", "selection"]),
        lowerLimit: z.coerce.number().nullish(),
        targetValue: z.coerce.number().nullish(),
        upperLimit: z.coerce.number().nullish(),
        unit: z.string().max(80).nullish(),
        allowedValues: z.array(z.string()).default([]),
        critical: z.boolean().default(false),
        destructive: z.boolean().default(false),
        instructions: z.string().max(3000).nullish(),
      }),
    )
    .min(1),
});

export const qualityInspectionCreateSchema = z.object({
  inspectionNumber: z.string().max(100).optional(),
  planId: uuid,
  inspectionType: z.string().trim().min(1).max(100),
  sourceType: z.enum([
    "procurement_receipt",
    "stock_batch",
    "stock_serial",
    "manufacturing_work_order",
    "manufacturing_posting",
    "sales_return",
    "pos_return",
    "manual",
  ]),
  sourceId: uuid.nullish(),
  itemId: uuid.nullish(),
  supplierId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  batchId: uuid.nullish(),
  serialId: uuid.nullish(),
  lotQuantity: z.coerce.number().min(0).default(0),
  sampleQuantity: z.coerce.number().min(0).default(0),
});

export const qualityInspectionActionSchema = z
  .object({
    action: z.enum(["complete", "release"]),
  })
  .passthrough();

export const qualityNonconformanceCreateSchema = z.object({
  nonconformanceNumber: z.string().max(100).optional(),
  inspectionId: uuid.nullish(),
  sourceType: z.string().trim().min(1).max(100),
  sourceId: uuid.nullish(),
  itemId: uuid.nullish(),
  supplierId: uuid.nullish(),
  batchId: uuid.nullish(),
  serialId: uuid.nullish(),
  severity: z.enum(["minor", "major", "critical"]),
  category: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  detectedQuantity: z.coerce.number().min(0).default(0),
  affectedQuantity: z.coerce.number().min(0).default(0),
  ownerUserId: uuid.nullish(),
  dueDate: z.string().date().nullish(),
});




export const qualityHoldReleaseSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  reason: z.string().trim().min(1).max(2000),
  expectedVersion: z.coerce.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});
