import { z } from "zod";

const uuid = z.string().uuid();

export const assetCategoryCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  capitalizationThreshold: z.coerce.number().min(0).default(0),
  usefulLifeMonths: z.coerce.number().int().positive().default(60),
  depreciationMethod: z
    .enum(["straight_line", "declining_balance", "units_of_production", "none"])
    .default("straight_line"),
  residualValuePercent: z.coerce.number().min(0).max(100).default(0),
  assetAccountId: uuid.nullish(),
  accumulatedDepreciationAccountId: uuid.nullish(),
  depreciationExpenseAccountId: uuid.nullish(),
  gainLossAccountId: uuid.nullish(),
});

export const assetCreateSchema = z.object({
  assetNumber: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullish(),
  categoryId: uuid,
  branchId: uuid.nullish(),
  itemId: uuid.nullish(),
  serialNumber: z.string().max(200).nullish(),
  manufacturer: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  purchaseOrderId: uuid.nullish(),
  procurementReceiptId: uuid.nullish(),
  vendorBillId: uuid.nullish(),
  acquisitionDate: z.string().date().nullish(),
  acquisitionCost: z.coerce.number().min(0).default(0),
  residualValue: z.coerce.number().min(0).optional(),
  currencyCode: z.string().trim().length(3).default("INR"),
  usefulLifeMonths: z.coerce.number().int().positive().optional(),
  depreciationMethod: z
    .enum(["straight_line", "declining_balance", "units_of_production", "none"])
    .optional(),
  warrantyStartDate: z.string().date().nullish(),
  warrantyEndDate: z.string().date().nullish(),
});

export const assetActionSchema = z
  .object({
    action: z.enum(["capitalize", "assign", "create_maintenance", "dispose"]),
  })
  .passthrough();
