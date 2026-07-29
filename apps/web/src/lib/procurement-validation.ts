import { z } from "zod";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(""), z.null()]).optional();
const decimal = z.union([z.string(), z.number()]).refine(
  (value) => /^\d+(?:\.\d{1,6})?$/.test(String(value)),
  "Use a positive number with up to six decimal places.",
);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

const internalFields = new Set([
  "status",
  "approvalStatus",
  "allowLifecycleEdit",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "version",
  "contentHash",
  "lastAction",
]);

function rejectInternalFields(value: Record<string, unknown>, context: z.RefinementCtx) {
  for (const key of Object.keys(value)) {
    if (internalFields.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is controlled by the Procurement lifecycle and cannot be supplied by clients.`,
      });
    }
  }
}

const lineSchema = z
  .object({
    id: optionalUuid,
    itemId: optionalUuid,
    uomId: optionalUuid,
    warehouseId: optionalUuid,
    purchaseOrderLineId: optionalUuid,
    requisitionLineId: optionalUuid,
    description: z.string().trim().min(1).max(1000),
    quantity: decimal.default("1"),
    unitPrice: decimal.default("0"),
    taxAmount: decimal.optional(),
    acceptedQuantity: decimal.optional(),
    rejectedQuantity: decimal.optional(),
    receivedQuantity: decimal.optional(),
    invoicedQuantity: decimal.optional(),
  })
  .passthrough();

const common = z
  .object({
    companyId: optionalUuid,
    branchId: optionalUuid,
    currencyCode: z.string().trim().length(3).default("INR"),
    idempotencyKey: z.string().trim().max(200).optional(),
  })
  .passthrough()
  .superRefine(rejectInternalFields);

const documentSchemas = {
  suppliers: common.extend({
    partyId: optionalUuid,
    supplierCode: z.string().trim().min(1).max(60),
    legalName: z.string().trim().min(1).max(240),
    displayName: z.string().trim().max(240).optional(),
    sites: z.array(z.record(z.string(), z.unknown())).optional(),
    qualifications: z.array(z.record(z.string(), z.unknown())).optional(),
    certifications: z.array(z.record(z.string(), z.unknown())).optional(),
    scorecards: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  categories: common.extend({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
  }),
  catalogs: common.extend({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(160),
    items: z.array(lineSchema).optional(),
  }),
  requisitions: common.extend({
    title: z.string().trim().min(1).max(240),
    requestedBy: optionalUuid,
    needByDate: date,
    lines: z.array(lineSchema).min(1),
    distributions: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  "sourcing-events": common.extend({
    title: z.string().trim().min(1).max(240),
    eventType: z.enum(["rfi", "rfq", "rfp", "tender", "auction"]).default("rfq"),
    bidCloseAt: z.string().trim().min(1).max(40),
    invitations: z.array(z.record(z.string(), z.unknown())).optional(),
    bids: z.array(z.record(z.string(), z.unknown())).optional(),
    evaluations: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  agreements: common.extend({
    title: z.string().trim().min(1).max(240),
    supplierId: uuid,
    validFrom: date,
    validUntil: date,
    lines: z.array(lineSchema).min(1),
  }),
  "purchase-orders": common.extend({
    title: z.string().trim().min(1).max(240).default("Purchase order"),
    supplierId: uuid,
    expectedDeliveryDate: date,
    lines: z.array(lineSchema).min(1),
    schedules: z.array(z.record(z.string(), z.unknown())).optional(),
    shippingNotices: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  receipts: common.extend({
    purchaseOrderId: uuid,
    receiptDate: date,
    lines: z.array(lineSchema).min(1),
  }),
  "service-entries": common.extend({
    purchaseOrderId: uuid,
    serviceDate: date,
    lines: z.array(lineSchema).min(1),
  }),
  returns: common.extend({
    receiptId: uuid,
    reason: z.string().trim().min(1).max(1000),
    lines: z.array(lineSchema).min(1),
  }),
  "match-exceptions": common.extend({
    purchaseOrderId: uuid,
    invoiceNumber: z.string().trim().min(1).max(100),
    title: z.string().trim().max(240).optional(),
    varianceAmount: decimal.default("0"),
    matchingRecords: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
};

type ProcurementDocumentResource = keyof typeof documentSchemas;

function getDocumentSchema(resource: string) {
  if (!Object.prototype.hasOwnProperty.call(documentSchemas, resource)) return undefined;
  return documentSchemas[resource as ProcurementDocumentResource];
}

const childSchema = z
  .object({
    companyId: optionalUuid,
    parentId: optionalUuid,
  })
  .passthrough()
  .superRefine(rejectInternalFields)
  .refine((value) => Object.keys(value).length > 0, "Provide Procurement data.");

export const procurementCreateSchema = z
  .record(z.string(), z.unknown())
  .superRefine(rejectInternalFields)
  .refine((value) => Object.keys(value).length > 0, "Provide Procurement data.");

export const procurementUpdateSchema = z
  .record(z.string(), z.unknown())
  .superRefine(rejectInternalFields)
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export function parseProcurementCreate(resource: string, value: unknown) {
  return (getDocumentSchema(resource) || childSchema).parse(value);
}

export function parseProcurementUpdate(resource: string, value: unknown) {
  const schema = getDocumentSchema(resource);
  if (!schema) return childSchema.partial().parse(value);
  return schema
    .partial()
    .extend({ expectedVersion: z.coerce.number().int().positive() })
    .superRefine(rejectInternalFields)
    .parse(value);
}

export const procurementActionSchema = z
  .object({
    action: z.enum([
      "submit",
      "approve",
      "reject",
      "qualify",
      "activate",
      "block",
      "suspend",
      "dispatch",
      "acknowledge",
      "close",
      "cancel",
      "resolve",
      "override",
      "reopen",
      "reverse",
      "amend",
      "award",
    ]),
    reason: z.string().trim().max(1000).optional(),
    expectedVersion: z.coerce.number().int().positive(),
  })
  .passthrough()
  .superRefine(rejectInternalFields);

export const procurementMatchSchema = z
  .object({
    purchaseOrderId: uuid,
    invoiceId: optionalUuid,
    sourceGoodsReceiptId: optionalUuid,
    invoiceNumber: z.string().trim().min(1).max(100),
    matchMode: z.enum(["two-way", "three-way", "four-way"]).default("three-way"),
    tolerancePercent: z.coerce.number().min(0).max(100).optional(),
    overrideReason: z.string().trim().min(1).max(1000).optional(),
    invoiceLines: z.array(lineSchema).min(1),
  })
  .passthrough();
