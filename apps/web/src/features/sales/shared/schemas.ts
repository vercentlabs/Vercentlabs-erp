import { z } from "zod";

// Shared request shapes for quotation and sales-order documents. These mirror
// exactly the keys previewSalesDocument/calculateLine read (see
// services/api/src/modules/sales/index.js); the domain layer remains the
// authority on every business rule (pricing, tax, credit, thresholds) -- this
// only rejects malformed transport data before it gets there.
const uuid = z.string().uuid();
const optionalDate = z.string().date().nullish();

const documentLineSchema = z.object({
  itemId: uuid,
  quantity: z.union([z.number(), z.string()]),
  uomId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  unitPrice: z.union([z.number(), z.string()]).nullish(),
  discountType: z.enum(["percent", "amount"]).nullish(),
  discountValue: z.union([z.number(), z.string()]).nullish(),
  description: z.string().trim().max(2000).nullish(),
  requestedDeliveryDate: optionalDate,
  manualPriceReason: z.string().trim().max(500).nullish(),
  // Saving a draft order: the line this one replaces, so a quoted line keeps its quoted price.
  salesOrderLineId: uuid.nullish(),
});

const documentChargeSchema = z.object({
  chargeType: z.string().trim().max(60).optional(),
  label: z.string().trim().max(120).optional(),
  calculationType: z.enum(["fixed", "percentage"]),
  value: z.union([z.number(), z.string()]),
  taxable: z.boolean().optional(),
});

export const documentSchema = z.object({
  partyId: uuid,
  contactId: uuid.nullish(),
  ownerUserId: uuid.nullish(),
  opportunityId: uuid.nullish(),
  priceListId: uuid.nullish(),
  paymentTermId: uuid.nullish(),
  // Additional payment terms for this document only, printed with its terms.
  paymentTermsNote: z.string().trim().max(1000).nullish(),
  billingAddressId: uuid.nullish(),
  shippingAddressId: uuid.nullish(),
  currencyCode: z.string().trim().length(3).nullish(),
  exchangeRate: z.union([z.number(), z.string()]).nullish(),
  validUntil: optionalDate,
  quotationDate: optionalDate,
  customerReference: z.string().trim().max(200).nullish(),
  expectedVersionNumber: z.number().int().positive().nullish(),
  orderDate: optionalDate,
  requestedDeliveryDate: optionalDate,
  customerPoNumber: z.string().trim().max(120).nullish(),
  defaultWarehouseId: uuid.nullish(),
  customerPoDate: optionalDate,
  externalReference: z.string().trim().max(200).nullish(),
  // Tax is worked out by the server; these are sent only to override it (each needs a permission and a reason).
  sellerRegistrationId: uuid.nullish(),
  placeOfSupply: z.string().trim().max(10).nullish(),
  placeOfSupplyReason: z.string().trim().max(500).nullish(),
  supplyType: z.string().trim().max(60).nullish(),
  taxOverrideReason: z.string().trim().max(500).nullish(),
  priority: z.string().trim().max(30).nullish(),
  incoterm: z.string().trim().max(30).nullish(),
  shippingMethod: z.string().trim().max(120).nullish(),
  deliveryTerms: z.string().trim().max(2000).nullish(),
  termsAndConditions: z.string().trim().max(20000).nullish(),
  customerNotes: z.string().trim().max(5000).nullish(),
  internalNotes: z.string().trim().max(5000).nullish(),
  // Discounts are sent as entered (type and value); every amount is calculated by the server.
  documentDiscountType: z.enum(["percent", "amount"]).nullish(),
  documentDiscountValue: z.union([z.number(), z.string()]).nullish(),
  discountReasonCode: z.string().trim().max(40).nullish(),
  discountReasonText: z.string().trim().max(1000).nullish(),
  revisionReason: z.string().trim().max(1000).nullish(),
  idempotencyKey: z.string().trim().max(200).nullish(),
  lines: z.array(documentLineSchema).min(1).max(500),
  charges: z.array(documentChargeSchema).max(50).optional(),
});

export const emptySchema = z.object({}).passthrough();
