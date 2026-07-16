import { z } from "zod";

import type { BusinessDataResourceKey } from "@vercent/shared-types";

const uuid = z.string().uuid();
const status = z.enum(["active", "inactive"]);
const companyStatus = status.default("active");
const code = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .transform((value) => value.toUpperCase());

const shortText = z.string().trim().max(160).optional().default("");
const longText = z.string().trim().max(2000).optional().default("");
const nonNegativeMoney = z.coerce
  .number()
  .finite()
  .min(0)
  .max(999_999_999_999_999);
const optionalUuid = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  uuid.nullable(),
);
const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
);
const optionalEmail = z.preprocess(
  (value) => (value === "" || value === undefined ? "" : value),
  z.string().trim().toLowerCase().email().max(254).or(z.literal("")),
);
const currencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());
const countryCode = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toUpperCase());

const partySchema = z.object({
  companyId: optionalUuid,
  code,
  partyType: z.enum(["customer", "supplier", "both", "prospect"]),
  displayName: z.string().trim().min(2).max(180),
  legalName: shortText,
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/)
    .or(z.literal(""))
    .optional()
    .default(""),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .or(z.literal(""))
    .optional()
    .default(""),
  msmeNumber: shortText,
  currencyCode,
  creditLimit: nonNegativeMoney.default(0),
  paymentTermId: optionalUuid,
  status: companyStatus,
});

const contactSchema = z.object({
  partyId: uuid,
  firstName: z.string().trim().min(1).max(100),
  lastName: shortText,
  designation: shortText,
  email: optionalEmail,
  phone: z.string().trim().max(30).optional().default(""),
  mobile: z.string().trim().max(30).optional().default(""),
  isPrimary: z.coerce.boolean().default(false),
  status: companyStatus,
});

const addressSchema = z.object({
  partyId: uuid,
  addressType: z.enum([
    "registered",
    "billing",
    "shipping",
    "office",
    "plant",
    "other",
  ]),
  line1: z.string().trim().min(2).max(200),
  line2: shortText,
  city: z.string().trim().min(2).max(120),
  district: shortText,
  state: z.string().trim().min(2).max(120),
  stateCode: z.string().trim().max(10).optional().default(""),
  postalCode: z.string().trim().min(3).max(20),
  countryCode,
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{15}$/)
    .or(z.literal(""))
    .optional()
    .default(""),
  isPrimary: z.coerce.boolean().default(false),
  status: companyStatus,
});

const uomSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  category: z.enum([
    "quantity",
    "weight",
    "volume",
    "length",
    "area",
    "time",
    "packaging",
    "other",
  ]),
  decimalPlaces: z.coerce.number().int().min(0).max(6).default(3),
  isBase: z.coerce.boolean().default(false),
  status: companyStatus,
});

const itemGroupSchema = z.object({
  parentId: optionalUuid,
  code,
  name: z.string().trim().min(2).max(120),
  description: longText,
  status: companyStatus,
});

const itemSchema = z.object({
  companyId: optionalUuid,
  code,
  name: z.string().trim().min(2).max(180),
  description: longText,
  itemType: z.enum(["product", "service", "consumable", "asset"]),
  groupId: optionalUuid,
  uomId: uuid,
  hsnSacCode: z.string().trim().max(20).optional().default(""),
  barcode: z.string().trim().max(80).optional().default(""),
  trackInventory: z.coerce.boolean().default(true),
  allowNegativeStock: z.coerce.boolean().default(false),
  valuationMethod: z
    .enum(["moving_average", "fifo", "standard"])
    .default("moving_average"),
  standardCost: nonNegativeMoney.default(0),
  salesPrice: nonNegativeMoney.default(0),
  purchasePrice: nonNegativeMoney.default(0),
  taxCategoryId: optionalUuid,
  status: companyStatus,
});

const taxCategorySchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  description: longText,
  status: companyStatus,
});

const taxRateSchema = z
  .object({
    companyId: optionalUuid,
    taxCategoryId: uuid,
    name: z.string().trim().min(2).max(120),
    code,
    taxType: z.enum([
      "gst",
      "igst",
      "cgst",
      "sgst",
      "cess",
      "vat",
      "sales_tax",
      "other",
    ]),
    rate: z.coerce.number().finite().min(0).max(100),
    effectiveFrom: optionalDate,
    effectiveTo: optionalDate,
    status: companyStatus,
  })
  .refine(
    (value) =>
      !value.effectiveFrom ||
      !value.effectiveTo ||
      value.effectiveFrom <= value.effectiveTo,
    {
      message: "Effective-to date must not precede effective-from date.",
      path: ["effectiveTo"],
    },
  );

const warehouseSchema = z.object({
  companyId: uuid,
  branchId: optionalUuid,
  name: z.string().trim().min(2).max(150),
  code,
  warehouseType: z.enum([
    "stores",
    "raw_material",
    "work_in_progress",
    "finished_goods",
    "transit",
    "returns",
    "virtual",
  ]),
  allowNegativeStock: z.coerce.boolean().default(false),
  status: companyStatus,
});

const warehouseLocationSchema = z.object({
  warehouseId: uuid,
  parentLocationId: optionalUuid,
  name: z.string().trim().min(1).max(120),
  code,
  locationType: z.enum([
    "zone",
    "aisle",
    "rack",
    "bin",
    "staging",
    "quality",
    "other",
  ]),
  capacity: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.coerce.number().finite().min(0).nullable(),
  ),
  status: companyStatus,
});

const paymentTermSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  description: longText,
  defaultDueDays: z.coerce.number().int().min(0).max(3650).default(0),
  status: companyStatus,
});

const priceListSchema = z
  .object({
    code,
    name: z.string().trim().min(2).max(120),
    priceListType: z.enum(["sales", "purchase"]),
    currencyCode,
    taxInclusive: z.coerce.boolean().default(false),
    validFrom: optionalDate,
    validTo: optionalDate,
    status: companyStatus,
  })
  .refine(
    (value) =>
      !value.validFrom || !value.validTo || value.validFrom <= value.validTo,
    {
      message: "Valid-to date must not precede valid-from date.",
      path: ["validTo"],
    },
  );

const fiscalPeriodSchema = z
  .object({
    companyId: uuid,
    name: z.string().trim().min(2).max(120),
    fiscalYear: z.string().trim().min(4).max(20),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["open", "closed", "locked"]).default("open"),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "End date must not precede start date.",
    path: ["endDate"],
  });

const currencySchema = z.object({
  code: currencyCode,
  name: z.string().trim().min(2).max(120),
  symbol: z.string().trim().max(12).optional().default(""),
  decimalPlaces: z.coerce.number().int().min(0).max(6).default(2),
  isBase: z.coerce.boolean().default(false),
  status: companyStatus,
});

const exchangeRateSchema = z.object({
  companyId: optionalUuid,
  fromCurrencyCode: currencyCode,
  toCurrencyCode: currencyCode,
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.coerce.number().finite().positive().max(1_000_000_000),
  source: z.string().trim().min(2).max(80).default("manual"),
  status: companyStatus,
});

export const businessDataSchemas = {
  parties: partySchema,
  contacts: contactSchema,
  addresses: addressSchema,
  "units-of-measure": uomSchema,
  "item-groups": itemGroupSchema,
  items: itemSchema,
  "tax-categories": taxCategorySchema,
  "tax-rates": taxRateSchema,
  warehouses: warehouseSchema,
  "warehouse-locations": warehouseLocationSchema,
  "payment-terms": paymentTermSchema,
  "price-lists": priceListSchema,
  "fiscal-periods": fiscalPeriodSchema,
  currencies: currencySchema,
  "exchange-rates": exchangeRateSchema,
} satisfies Record<BusinessDataResourceKey, z.ZodType>;

export const businessDataImportEnvelopeSchema = z.object({
  fileName: z.string().trim().max(255).optional().default(""),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
});
