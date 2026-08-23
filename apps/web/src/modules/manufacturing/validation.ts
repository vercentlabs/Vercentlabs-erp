import { z } from "zod";

const uuid = z.string().uuid();

export const bomCreateSchema = z.object({
  itemId: uuid,
  code: z.string().trim().min(1).max(80),
  version: z.coerce.number().int().positive().default(1),
  outputQuantity: z.coerce.number().positive().default(1),
  outputUomId: uuid.nullish(),
  effectiveFrom: z.string().date().nullish(),
  effectiveTo: z.string().date().nullish(),
  notes: z.string().max(5000).nullish(),
  components: z
    .array(
      z.object({
        itemId: uuid,
        quantity: z.coerce.number().positive(),
        uomId: uuid.nullish(),
        scrapPercent: z.coerce.number().min(0).max(100).default(0),
        issueMethod: z.enum(["manual", "backflush"]).default("manual"),
        warehouseId: uuid.nullish(),
        operationSequence: z.coerce.number().int().positive().nullish(),
        notes: z.string().max(1000).nullish(),
      }),
    )
    .min(1),
});

export const workOrderCreateSchema = z.object({
  workOrderNumber: z.string().trim().min(1).max(80).optional(),
  bomId: uuid,
  routingId: uuid.nullish(),
  branchId: uuid.nullish(),
  quantity: z.coerce.number().positive(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  plannedStartAt: z.string().datetime().nullish(),
  plannedEndAt: z.string().datetime().nullish(),
  materialWarehouseId: uuid,
  wipWarehouseId: uuid,
  finishedGoodsWarehouseId: uuid,
  sourceType: z.string().max(80).nullish(),
  sourceId: uuid.nullish(),
});

export const productionPostSchema = z.object({
  quantity: z.coerce.number().positive(),
  idempotencyKey: z.string().trim().min(8).max(200),
  warehouseLocationId: uuid.nullish(),
  batchId: uuid.nullish(),
  serialId: uuid.nullish(),
  unitCost: z.coerce.number().min(0).default(0),
  materialUnitCosts: z.record(z.string(), z.coerce.number().min(0)).optional(),
});
