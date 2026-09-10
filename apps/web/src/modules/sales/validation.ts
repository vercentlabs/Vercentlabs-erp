import { z } from "zod";
const nullableUuid = z.string().uuid().optional().nullable();
const decimal = z.union([z.string().trim().regex(/^-?\d+(\.\d+)?$/), z.number().finite()]);
const line = z.object({
  itemId: z.string().uuid(), uomId: nullableUuid, warehouseId: nullableUuid,
  description: z.string().max(4000).optional().nullable(), quantity: decimal,
  unitPrice: decimal.optional().nullable(), discountPercent: decimal.optional(),
  requestedDeliveryDate: z.string().date().optional().nullable(),
  manualPriceReason: z.string().max(1000).optional().nullable(),
});
const charge = z.object({
  chargeType: z.enum(["freight","handling","insurance","packing","other"]),
  label: z.string().trim().min(1).max(120), calculationType: z.enum(["fixed","percentage"]),
  value: decimal, taxable: z.boolean().optional(),
});
export const salesDocumentSchema = z.object({
  companyId: z.string().uuid(), branchId: nullableUuid, partyId: z.string().uuid(), contactId: nullableUuid,
  opportunityId: nullableUuid, ownerUserId: nullableUuid, currencyCode: z.string().trim().length(3),
  exchangeRate: decimal.optional(), priceListId: nullableUuid, paymentTermId: nullableUuid,
  billingAddressId: nullableUuid, shippingAddressId: nullableUuid,
  validUntil: z.string().date().optional(), requestedDeliveryDate: z.string().date().optional().nullable(),
  orderDate: z.string().date().optional().nullable(), customerPoNumber: z.string().max(120).optional().nullable(),
  customerPoDate: z.string().date().optional().nullable(), priority: z.enum(["low","normal","high","urgent"]).optional(),
  deliveryTerms: z.string().max(4000).optional().nullable(), shippingMethod: z.string().max(4000).optional().nullable(),
  incoterm: z.string().max(40).optional().nullable(), placeOfSupply: z.string().max(80).optional().nullable(),
  supplyType: z.enum(["domestic","export","sez","exempt","non_gst"]).optional(),
  internalNotes: z.string().max(10000).optional().nullable(), customerNotes: z.string().max(10000).optional().nullable(),
  termsAndConditions: z.string().max(20000).optional().nullable(), revisionReason: z.string().max(1000).optional().nullable(),
  amendmentReason: z.string().max(1000).optional().nullable(), lines: z.array(line).min(1).max(500), charges: z.array(charge).max(50).optional(),
  // F023 — optional; only createQuotation currently honors it (see
  // services/api/src/modules/sales/index.js). Present here (rather than a
  // separate schema) so the SAME document-editor.tsx payload() shape is
  // valid for both quotation and order submission without branching schemas.
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
}).strict();
export const salesActionSchema = z.object({
  action: z.enum(["submit","send","convert","confirm","hold","release_hold","cancel","close","request_fulfillment","complete_fulfillment","request_invoice","record_decision","amend"]),
  assignedTo: nullableUuid, expiresInDays: z.number().int().min(1).max(90).optional(),
  holdType: z.enum(["credit","commercial","inventory","compliance","customer","other"]).optional(),
  holdId: nullableUuid, reason: z.string().max(2000).optional().nullable(), note: z.string().max(4000).optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(), quantityBasis: z.enum(["ordered","fulfilled"]).optional(),
  overrideCredit: z.boolean().optional(), creditOverrideReason: z.string().max(1000).optional().nullable(),
  decision: z.enum(["accepted","rejected"]).optional(), customerName: z.string().max(200).optional(),
  customerEmail: z.string().email().max(320).optional().nullable(), customerTitle: z.string().max(160).optional().nullable(),
  typedSignature: z.string().max(300).optional().nullable(),
  requestId: nullableUuid,
  externalReference: z.string().max(200).optional().nullable(),
  fulfillmentLines: z.array(z.object({ salesOrderLineId: z.string().uuid(), fulfilledQuantity: decimal }).strict()).min(1).optional(),
  document: salesDocumentSchema.optional(),
}).strict();
