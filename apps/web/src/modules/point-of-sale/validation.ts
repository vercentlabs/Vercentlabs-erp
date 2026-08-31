import { z } from "zod";

const uuid = z.string().uuid();

export const posStoreCreateSchema = z.object({
  branchId: uuid,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  warehouseId: uuid,
  priceListId: uuid.nullish(),
  currencyCode: z.string().trim().length(3).default("INR"),
  timezone: z.string().trim().min(1).default("Asia/Kolkata"),
});

export const posTerminalCreateSchema = z.object({
  storeId: uuid,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  receiptPrefix: z.string().trim().min(1).max(20).default("POS"),
});

export const posShiftOpenSchema = z.object({
  storeId: uuid,
  terminalId: uuid,
  shiftNumber: z.string().trim().min(1).max(80).optional(),
  cashierUserId: uuid.nullish(),
  openingCash: z.coerce.number().min(0).default(0),
});

export const posSaleCompleteSchema = z.object({
  shiftId: uuid,
  customerId: uuid.nullish(),
  customerName: z.string().max(200).nullish(),
  currencyCode: z.string().trim().length(3).optional(),
  receiptNumber: z.string().max(100).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  roundingAdjustment: z.coerce.number().default(0),
  lines: z
    .array(
      z.object({
        itemId: uuid,
        description: z.string().trim().min(1).max(500),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
        unitCost: z.coerce.number().min(0).default(0),
        discountAmount: z.coerce.number().min(0).default(0),
        taxAmount: z.coerce.number().min(0).default(0),
        warehouseId: uuid.optional(),
        warehouseLocationId: uuid.nullish(),
        batchId: uuid.nullish(),
        serialId: uuid.nullish(),
        priceOverride: z.boolean().default(false),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        method: z.enum([
          "cash",
          "card",
          "upi",
          "bank_transfer",
          "wallet",
          "store_credit",
        ]),
        amount: z.coerce.number().positive(),
        providerReference: z.string().max(200).nullish(),
        authorizationReference: z.string().max(200).nullish(),
      }),
    )
    .min(1),
});

export const posReturnCreateSchema = z.object({
  saleId: uuid,
  returnNumber: z.string().max(100).optional(),
  reason: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(8).max(200),
  // Kept as optional compatibility assertions. The API calculates refund
  // amounts from the original sale and rejects a mismatching client value.
  refundTotal: z.coerce.number().min(0).optional(),
  lines: z
    .array(
      z.object({
        saleLineId: uuid,
        quantity: z.coerce.number().positive(),
        refundAmount: z.coerce.number().min(0).optional(),
        restock: z.boolean().default(true),
      }),
    )
    .min(1),
});

export const posReturnActionSchema = z.object({
  action: z.enum(["approve", "complete"]),
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export const posShiftCloseSchema = z.object({
  countedCash: z.coerce.number().min(0),
  closeNotes: z.string().max(2000).nullish(),
});
