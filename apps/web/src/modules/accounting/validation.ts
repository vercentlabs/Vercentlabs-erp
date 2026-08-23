import { z } from "zod";

const uuid = z.string().uuid();
const amount = z.union([z.string(), z.number()]);

const commercialLineSchema = z.object({
  sourceSalesOrderLineId: uuid.nullish(),
  itemId: uuid.nullish(),
  uomId: uuid.nullish(),
  description: z.string().trim().min(1).max(1000),
  quantity: amount.optional(),
  unitPrice: amount,
  discountAmount: amount.optional(),
  taxAmount: amount.optional(),
  withholdingAmount: amount.optional(),
  accountId: uuid.nullish(),
  taxAccountId: uuid.nullish(),
  withholdingAccountId: uuid.nullish(),
  branchId: uuid.nullish(),
  departmentId: uuid.nullish(),
  costCenterId: uuid.nullish(),
  hsnSacCode: z.string().trim().max(30).nullish(),
  taxDetails: z.array(z.object({
    taxType: z.string().trim().min(1).max(40),
    taxRate: amount.optional(),
    taxableAmount: amount.optional(),
    taxAmount: amount,
    recoverableAmount: amount.optional(),
  }).strict()).optional(),
}).strict();

export const journalSchema = z.object({
  companyId: uuid,
  branchId: uuid.nullish(),
  ledgerId: uuid.nullish(),
  journalId: uuid,
  entryDate: z.string().date().optional(),
  accountingDate: z.string().date(),
  documentDate: z.string().date().nullish(),
  entryType: z.string().max(50).optional(),
  reference: z.string().max(200).nullish(),
  description: z.string().trim().min(1).max(1000),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: amount.optional(),
  lines: z.array(z.object({
    accountId: uuid,
    partyId: uuid.nullish(),
    branchId: uuid.nullish(),
    departmentId: uuid.nullish(),
    costCenterId: uuid.nullish(),
    description: z.string().max(1000).nullish(),
    debit: amount.optional(),
    credit: amount.optional(),
    currencyCode: z.string().length(3).nullish(),
    exchangeRate: amount.optional(),
    dueDate: z.string().date().nullish(),
    dimensions: z.array(z.object({
      dimensionId: uuid,
      dimensionValueId: uuid,
      allocationPercent: amount.optional(),
    }).strict()).optional(),
  }).strict()).min(2),
}).strict();

export const invoiceSchema = z.object({
  invoiceType: z.enum(["invoice", "credit_note", "debit_note", "opening"]).optional(),
  sourceInvoiceId: uuid.nullish(),
  sourceSalesOrderId: uuid.nullish(),
  sourceSalesInvoiceRequestId: uuid.nullish(),
  companyId: uuid,
  branchId: uuid.nullish(),
  ledgerId: uuid.nullish(),
  partyId: uuid,
  billingAddressId: uuid.nullish(),
  invoiceDate: z.string().date().optional(),
  accountingDate: z.string().date().optional(),
  dueDate: z.string().date().nullish(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: amount.optional(),
  chargeTotal: amount.optional(),
  roundingAdjustment: amount.optional(),
  placeOfSupply: z.string().max(100).nullish(),
  supplyType: z.enum(["domestic", "export", "sez", "exempt", "non_gst"]).optional(),
  notes: z.string().max(2000).nullish(),
  termsAndConditions: z.string().max(5000).nullish(),
  lines: z.array(commercialLineSchema).min(1),
}).strict();

export const vendorBillSchema = z.object({
  billType: z.enum(["bill", "credit_note", "debit_note", "opening"]).optional(),
  sourceBillId: uuid.nullish(),
  sourcePurchaseOrderId: uuid.nullish(),
  sourceGoodsReceiptId: uuid.nullish(),
  companyId: uuid,
  branchId: uuid.nullish(),
  ledgerId: uuid.nullish(),
  partyId: uuid,
  supplierInvoiceNumber: z.string().trim().min(1).max(100),
  supplierInvoiceDate: z.string().date().nullish(),
  billDate: z.string().date().optional(),
  accountingDate: z.string().date().optional(),
  dueDate: z.string().date().nullish(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: amount.optional(),
  chargeTotal: amount.optional(),
  roundingAdjustment: amount.optional(),
  matchingStatus: z.enum(["not_required", "pending", "matched", "exception", "overridden"]).optional(),
  notes: z.string().max(2000).nullish(),
  lines: z.array(commercialLineSchema).min(1),
}).strict();

export const procurementVendorBillImportSchema = z.object({
  partyId: uuid.nullish(),
  sourceGoodsReceiptId: uuid.nullish(),
  branchId: uuid.nullish(),
  ledgerId: uuid.nullish(),
  supplierInvoiceDate: z.string().date().nullish(),
  billDate: z.string().date().optional(),
  accountingDate: z.string().date().optional(),
  dueDate: z.string().date().nullish(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: amount.optional(),
  chargeTotal: amount.optional(),
  roundingAdjustment: amount.optional(),
  notes: z.string().max(2000).nullish(),
}).strict();

export const accountingActionSchema = z.object({
  action: z.string().min(1).max(50),
  assignedTo: uuid.nullish(),
  reason: z.string().max(1000).nullish(),
  accountingDate: z.string().date().nullish(),
  contentHash: z.string().max(128).nullish(),
  status: z.string().max(40).nullish(),
  note: z.string().max(1000).nullish(),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const assetCategorySchema = z.object({
  companyId: uuid,
  ledgerId: uuid.nullish(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  assetAccountId: uuid,
  accumulatedDepreciationAccountId: uuid,
  depreciationExpenseAccountId: uuid,
  disposalGainAccountId: uuid,
  disposalLossAccountId: uuid,
  defaultMethod: z.enum(["straight_line", "declining_balance", "units_of_production", "none"]).optional(),
  defaultUsefulLifeMonths: z.coerce.number().int().min(1).max(1200).optional(),
  defaultDecliningRate: amount.nullish(),
  capitalizationThreshold: amount.optional(),
}).strict();

export const assetSchema = z.object({
  companyId: uuid,
  branchId: uuid.nullish(),
  ledgerId: uuid.nullish(),
  categoryId: uuid,
  name: z.string().trim().min(1).max(300),
  description: z.string().max(2000).nullish(),
  serialNumber: z.string().max(200).nullish(),
  sourceVendorBillId: uuid.nullish(),
  sourceVendorBillLineId: uuid.nullish(),
  acquisitionDate: z.string().date(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: amount.optional(),
  acquisitionCost: amount,
  salvageValue: amount.optional(),
  usefulLifeMonths: z.coerce.number().int().min(1).max(1200).optional(),
  depreciationMethod: z.enum(["straight_line", "declining_balance", "units_of_production", "none"]).optional(),
  decliningRate: amount.nullish(),
  departmentId: uuid.nullish(),
  costCenterId: uuid.nullish(),
  location: z.string().max(300).nullish(),
  custodianUserId: uuid.nullish(),
}).strict();

export const assetActionSchema = z.object({
  action: z.enum(["capitalize", "post_depreciation", "dispose", "writeoff", "transfer", "impair", "suspend", "resume"]),
  scheduleId: uuid.nullish(),
  capitalizationDate: z.string().date().nullish(),
  inServiceDate: z.string().date().nullish(),
  offsetAccountId: uuid.nullish(),
  disposalDate: z.string().date().nullish(),
  proceeds: amount.optional(),
  proceedsAccountId: uuid.nullish(),
  transactionDate: z.string().date().nullish(),
  impairmentDate: z.string().date().nullish(),
  amount: amount.optional(),
  expenseAccountId: uuid.nullish(),
  branchId: uuid.nullish(),
  departmentId: uuid.nullish(),
  costCenterId: uuid.nullish(),
  custodianUserId: uuid.nullish(),
  location: z.string().max(300).nullish(),
  reason: z.string().max(1000).nullish(),
  note: z.string().max(1000).nullish(),
}).strict();

export const budgetSchema = z.object({
  companyId: uuid,
  ledgerId: uuid.nullish(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  fiscalYear: z.string().trim().min(1).max(20),
  versionNumber: z.coerce.number().int().min(1).optional(),
  scenario: z.enum(["budget", "forecast", "reforecast", "plan"]).optional(),
  currencyCode: z.string().length(3).optional(),
  controlMode: z.enum(["none", "warning", "block"]).optional(),
  lines: z.array(z.object({
    accountId: uuid,
    branchId: uuid.nullish(),
    departmentId: uuid.nullish(),
    costCenterId: uuid.nullish(),
    periodNumber: z.coerce.number().int().min(1).max(14),
    amount,
  }).strict()).min(1),
}).strict();

export const budgetActionSchema = z.object({
  action: z.enum(["submit", "activate"]),
  assignedTo: uuid.nullish(),
}).strict();

export const recurringTemplateSchema = z.object({
  companyId: uuid,
  ledgerId: uuid.nullish(),
  journalId: uuid,
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  frequency: z.enum(["monthly", "quarterly", "half_yearly", "yearly", "custom"]).optional(),
  intervalCount: z.coerce.number().int().min(1).max(120).optional(),
  nextRunDate: z.string().date(),
  endDate: z.string().date().nullish(),
  autoPost: z.boolean().optional(),
  description: z.string().trim().min(1).max(1000),
  currencyCode: z.string().length(3).optional(),
  lines: z.array(z.object({
    accountId: uuid,
    partyId: uuid.nullish(),
    branchId: uuid.nullish(),
    departmentId: uuid.nullish(),
    costCenterId: uuid.nullish(),
    description: z.string().max(1000).nullish(),
    debit: amount.optional(),
    credit: amount.optional(),
  }).strict()).min(2),
}).strict();

export const accrualScheduleSchema = z.object({
  companyId: uuid,
  ledgerId: uuid.nullish(),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  scheduleType: z.enum(["accrual", "deferred_expense", "deferred_revenue"]),
  sourceType: z.string().max(100).nullish(),
  sourceId: uuid.nullish(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  totalAmount: amount,
  sourceAccountId: uuid,
  targetAccountId: uuid,
  frequency: z.enum(["monthly", "quarterly", "yearly", "custom"]).optional(),
}).strict();

export const taxReturnSchema = z.object({
  companyId: uuid,
  returnType: z.string().trim().min(1).max(50),
  taxRegistration: z.string().max(100).nullish(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  filingDueDate: z.string().date().nullish(),
}).strict();

export const revaluationSchema = z.object({
  companyId: uuid,
  ledgerId: uuid.nullish(),
  valuationDate: z.string().date(),
  sourceCurrencyCode: z.string().length(3),
  rate: amount.optional(),
}).strict();

export const intercompanyRuleSchema = z.object({
  fromCompanyId: uuid,
  toCompanyId: uuid,
  fromLedgerId: uuid.nullish(),
  toLedgerId: uuid.nullish(),
  dueFromAccountId: uuid,
  dueToAccountId: uuid,
  eliminationAccountId: uuid.nullish(),
}).strict();

export const intercompanyJournalSchema = z.object({
  ruleId: uuid,
  fromLedgerId: uuid.nullish(),
  toLedgerId: uuid.nullish(),
  accountingDate: z.string().date(),
  amount,
  exchangeRate: amount.optional(),
  description: z.string().trim().min(1).max(1000),
  fromExpenseOrAssetAccountId: uuid,
  toRevenueOrLiabilityAccountId: uuid,
  postImmediately: z.boolean().optional(),
}).strict();

export const dunningSchema = z.object({
  companyId: uuid,
  runDate: z.string().date().optional(),
  minimumDaysOverdue: z.coerce.number().int().min(0).max(3650).optional(),
  minimumAmount: amount.optional(),
}).strict();

export const consolidationGroupSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  reportingCurrencyCode: z.string().length(3),
  members: z.array(z.object({
    companyId: uuid,
    ledgerId: uuid.nullish(),
    ownershipPercent: z.coerce.number().positive().max(100).optional(),
    consolidationMethod: z.enum(["full", "proportionate", "equity"]).optional(),
  }).strict()).min(1),
}).strict();

export const consolidationRunSchema = z.object({
  groupId: uuid,
  periodEnd: z.string().date(),
}).strict();

export const consolidationActionSchema = z.object({
  action: z.enum(["adjust", "finalize"]),
  adjustmentType: z.enum(["elimination", "translation", "reclassification", "minority_interest", "manual"]).optional(),
  accountCode: z.string().max(50).optional(),
  companyId: uuid.nullish(),
  debitAmount: amount.optional(),
  creditAmount: amount.optional(),
  description: z.string().max(1000).optional(),
}).strict();

export const taxReturnActionSchema = z.object({
  status: z.enum(["draft", "review", "filed", "paid", "amended", "cancelled"]),
  externalReference: z.string().trim().max(200).nullish(),
}).strict();
