"use client";

// Supplier bills: the shapes the screens read and the calls they make. Every amount is the server's decimal string; the screen
// never calculates a total it shows — it asks the server for a preview.
import { ProcApiError } from "@/features/procurement/shared/http";

import type { BillPaymentSchedule } from "../screens/PaymentSchedule";

export class BillApiError extends ProcApiError {
  constructor(message: string, status: number, code: string | undefined, readonly details: Record<string, unknown>) {
    super(message, status, code);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/procurement${path}`, {
    credentials: "same-origin", ...init,
    headers: { Accept: "application/json", ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new BillApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const issuesOf = (error: unknown): string[] => {
  if (!(error instanceof BillApiError)) return [];
  const issues = (error.details.issues ?? (error.details.details as Record<string, unknown> | undefined)?.issues) as Array<{ message: string }> | undefined;
  return (issues ?? []).map((issue) => issue.message);
};
export const errorCode = (error: unknown) => (error instanceof ProcApiError ? error.code : undefined);

export type BillRow = {
  id: string; billNumber: string; supplierInvoiceNumber: string | null; supplierId: string | null; supplierName: string; supplierInvoiceDate: string; postingDate: string; dueDate: string | null;
  purchaseOrderId: string | null; purchaseOrderNumber: string | null; sourceType: string; currencyCode: string; invoiceTotal: string; netPayable: string; paid: string; credited: string;
  balanceDue: string; sourceBillId: string | null; sourceBillNumber: string | null; status: string; documentStatus: string; paymentStatus: string; dueStatus: string; matchingResult: string;
  twoWayResult: MatchResult; discrepancyCount: number; discrepancy: string | null;
};
export type MatchResult = "matched" | "mismatch" | "approved_exception" | "not_checked" | "not_applicable";
export type MatchDiscrepancy = {
  code: string; label: string; level: "header" | "line"; lineSequence: number | null; expected: string | null; actual: string | null; difference: string | null;
  direction?: "adverse" | "favorable" | null; message: string; guidance: string; approvable: boolean; approved: boolean; reason?: string | null;
};
export type MatchLine = {
  sequence: number; purchaseOrderLineId: string | null; orderLineNumber: number | null; description: string | null; billingBasis: string; ordered: string | null; cancelled: string | null;
  previouslyBilled: string | null; remaining: string | null; quantity: string | null; invoicedQuantity: string | null; agreedAmount: string | null; remainingAmount: string | null;
  billedAmount: string | null; expectedUnitPrice: string | null; expectedNetUnitPrice: string | null; actualUnitPrice: string | null; expectedNet: string | null; actualNet: string | null;
  variance: string | null; expectedTax: string | null; actualTax: string | null; codes: string[]; result: "matched" | "mismatch" | "approved_exception";
  matchingBasis: "three_way_accepted" | "three_way_received" | "two_way" | null; received: string | null; eligibleReceipt: string | null; previouslyAllocated: string | null;
  currentlyEligible: string | null; allocations: Array<{ goodsReceiptLineId: string; receiptNumber: string | null; quantity: string }>;
};
export type MatchEvaluation = {
  result: "matched" | "mismatch" | "approved_exception"; purchaseOrderRevision: number; header: Array<{ check: string; label: string; expected: string; actual: string; passed: boolean; code: string; message: string }>;
  lines: MatchLine[]; discrepancies: MatchDiscrepancy[]; expectedAmount: string; actualAmount: string; varianceAmount: string; evaluatedAt?: string; postedEvidence?: boolean;
  matchingType?: "two_way" | "three_way"; receiptBasis?: "accepted" | "physical_received" | null;
};
export type BillMatching = {
  billId: string; purchaseOrderId?: string; purchaseOrderNumber?: string; purchaseOrderRevision?: number; result: MatchResult; stale?: boolean; checkedAt?: string | null;
  evaluation: MatchEvaluation | null; evidence: MatchEvaluation | null;
  exceptions: Array<{ id: string; lineSequence: number | null; code: string; expected: string | null; actual: string | null; variance: string | null; reason: string; accountingTreatment: string;
    status: "approved" | "expired"; approvedBy: string | null; approvedAt: string; expiredAt: string | null }>;
  actions: { recheck: boolean; approveException: boolean };
};
export type TaxComponent = { type: string; label: string; rate: string; taxableBase?: string; taxAmount: string; classification: string };
export type BillLine = {
  id: string; lineNumber: number; productId: string | null; product: { code?: string | null; name?: string } | null; productType: string | null; description: string; hsnSacCode: string | null;
  quantity: string; uom: { code?: string } | null; unitPrice: string; gross: string; lineDiscountType: string | null; lineDiscountValue: string; lineDiscount: string; allocatedDocumentDiscount: string;
  taxableAmount: string; taxAmount: string; reverseCharge: boolean; reverseChargeTax: string; withholding: string; lineTotal: string; account: string; varianceAccount: string | null; variance: string;
  taxes: TaxComponent[]; purchaseOrderLineId: string | null; orderLineNumber: number | null; orderedQuantity: string | null; orderedUnitPrice: string | null; priceDifference: string | null;
  receipts: Array<{ goodsReceiptId: string; receiptNumber: string; receiptLineNumber: number; quantity: string }>; correctedQuantity: string; correctedValue: string;
  expenseCategoryId: string | null; expenseCategory: string | null; costCenterId: string | null; costCenter: string | null; departmentId: string | null; department: string | null;
  inputTaxEligibility: "eligible" | "blocked"; taxCategoryId: string | null; uomId: string | null; billingBasis: "quantity" | "amount"; billedAmount: string | null;
};
type Journal = { id: string; number: string; status: string; date: string; lines: Array<{ account: string; description: string; debit: string; credit: string; baseDebit: string; baseCredit: string }> } | null;
export type BillDetail = {
  bill: {
    id: string; billNumber: string; type: "bill" | "vendor_credit"; status: string; documentStatus: string; paymentStatus: string; dueStatus: string; matchingResult: string;
    supplierInvoiceNumber: string | null; supplierInvoiceDate: string; postingDate: string; dueDate: string | null; supplierId: string | null; supplierName: string;
    supplier: { supplierName?: string; supplierNumber?: string; legalName?: string; gstin?: string | null; pan?: string | null } | null;
    supplierTaxRegistration: { gstin?: string; stateCode?: string } | null; supplierAddress: { line1?: string; city?: string; stateCode?: string } | null;
    buyingRegistration: { name?: string; legalName?: string; gstin?: string } | null; placeOfSupply: string | null; supplyNature: string | null; reverseCharge: boolean; sourceType: string;
    sourceLabel: string; purchaseOrderId: string | null; purchaseOrderNumber: string | null; currencyCode: string; baseCurrencyCode: string; exchangeRate: string;
    paymentTerm: { name?: string } | null; priceMode: string; notes: string | null; subtotal: string; discountTotal: string; taxableTotal: string; taxTotal: string; reverseChargeTaxTotal: string;
    invoiceTotal: string; withholdingTotal: string; roundingAdjustment: string; netPayable: string; baseCurrencyTotal: string; supplierStatedTotal: string | null; paid: string; credited: string;
    balanceDue: string; withholdingSection: { id: string; code: string; name: string } | null; matchingStatus: string; matchOverrideReason: string | null; duplicateOverrideReason: string | null;
    duplicateOverrideByName: string | null; sourceBillId: string | null; sourceBillNumber: string | null; debitNoteReason: string | null; sourcePurchaseReturnId: string | null;
    purchaseReturnNumber: string | null; createdAt: string; createdByName: string | null; updatedAt: string; postedAt: string | null; postedByName: string | null; cancelledAt: string | null;
    cancelReason: string | null; reversedAt: string | null; reversedByName: string | null; reversalReason: string | null; computedDueDate: string | null;
    dueDateOverrideReason: string | null; invoiceReceivedDate: string | null; acceptanceDate: string | null; supplierStatedTerms: string | null; supplierStatedTermId: string | null;
    paymentTermChangeReason: string | null; supplierAddressId: string | null; supplierTaxRegistrationId: string | null; buyingRegistrationId: string | null; paymentTermId: string | null;
    matchingBasis: "purchase_order" | "goods_receipt" | null; sourceGoodsReceiptIds: string[];
  };
  lines: BillLine[];
  payments: Array<{ id: string; paymentId: string; paymentNumber: string; date: string; method: string; reference: string | null; amount: string; reversed: boolean; paymentStatus: string }>;
  credits: Array<{ creditId: string; number: string; amount: string; at: string; href: string }>;
  paymentSchedule: BillPaymentSchedule | null;
  vendorCredits: Array<{ id: string; number: string; status: string; date: string; total: string; unapplied: string; reason: string | null; href: string }>;
  related: { purchaseOrder: { id: string; number: string; status: string } | null; receipts: Array<{ id: string; number: string }>; returns: Array<{ id: string; number: string; date: string; reason: string }> };
  accounting: { journal: Journal; reverseCharge: Journal; reversal: Journal };
  settlementOptions: { advances: Array<{ id: string; number: string; date: string; available: string }>; credits: Array<{ id: string; number: string; available: string }> };
  reconciliation: { matched: boolean; journalPayable: string; total: string; paid: string; credited: string; outstanding: string; checks: Record<string, boolean> } | null;
  duplicates: Array<{ id: string; billNumber: string; supplierInvoiceNumber: string; status: string; billDate: string }>;
  history: Array<{ id: string; type: string; summary: string; at: string; actor: string | null }>;
  actions: Record<"edit" | "post" | "approve" | "cancel" | "reverse" | "createCredit" | "raiseClaim" | "recordPayment" | "applyAdvance" | "applyCredit" | "reversePayment" | "overrideDuplicate" | "overrideMatch" | "attach" | "voucher", boolean>;
};
export type BillOptions = {
  views: Array<{ key: string; label: string }>; sourceTypes: Array<{ code: string; label: string }>;
  suppliers: Array<{ id: string; supplier_number: string; name: string; status: string; currency_code: string | null; payment_term_id: string | null; withholding_section_id: string | null }>;
  accounts: Array<{ id: string; code: string; name: string; account_class: string }>; taxCategories: Array<{ id: string; code: string; name: string; reverse_charge: boolean }>;
  withholdingSections: Array<{ id: string; code: string; name: string; rate: string }>; paymentTerms: Array<{ id: string; code: string; name: string; term_type?: string; is_default?: boolean; needs_invoice_received_date?: boolean }>;
  currencies: Array<{ code: string; name: string }>; registrations: Array<{ id: string; code: string; name: string; gstin: string | null; state_code: string | null; is_default: boolean }>;
  bankAccounts: Array<{ id: string; name: string }>;
  expenseCategories: Array<{ id: string; code: string; name: string; account_id: string; default_tax_category_id: string | null; default_hsn_sac: string | null }>;
  costCenters: Array<{ id: string; code: string; name: string }>; departments: Array<{ id: string; code: string; name: string }>; uoms: Array<{ id: string; code: string; name: string }>;
  capabilities: Record<"manage" | "create" | "payments" | "reverse" | "overrideDuplicate" | "overrideMatch" | "overrideDueDate" | "categories", boolean>;
};
export type Eligibility = {
  order: { id: string; purchaseOrderNumber: string; status: string; currencyCode: string; priceMode: string; supplierId: string; matchingPolicy: string | null };
  lines: Array<{ purchaseOrderLineId: string; lineNumber: number; description: string; productType: string; uom: string | null; orderedUnitPrice: string; ordered: string; received: string;
    cancelled: string; returned: string; billable: string; billed: string; remainingToBill: string; basis: string; refusedAtDock: string; qualityRejected: string; openRejections: number;
    accepted: string; held: string; remainingCommitment: string; draftBilled: string; draftBills: string[]; amountBillable: boolean; agreedAmount: string; billedAmount: string;
    remainingAmount: string; amountBased: boolean;
    rejectionWarning: string | null; zeroPrice: boolean;
    receipts: Array<{ goodsReceiptLineId: string; goodsReceiptId: string; receiptNumber: string; billable: string; allocated: string; draftAllocated: string; remaining: string }> }>;
};
export type BillPreview = {
  totals: Record<string, string>; matchingStatus: string; warnings: string[];
  discrepancies: Array<{ lineNumber: number; ordered: string; billed: string; difference: string; totalDifference: string }>;
  duplicates: Array<{ id: string; billNumber: string; status: string }>;
  lines: Array<{ description: string; quantity: string; unitPrice: string; gross: string; lineDiscount: string; allocatedDocumentDiscount: string; taxableAmount: string; taxAmount: string;
    reverseChargeTax: string; withholding: string; lineTotal: string; variance: string; reverseCharge: boolean; components: TaxComponent[]; receipts: Array<{ receiptNumber: string; quantity: string }> }>;
  twoWay: (Omit<Partial<MatchEvaluation>, "result"> & { result: MatchResult }) | null;
  header: { supplierName: string; currencyCode: string; supplierGstin: string | null; registrationChoices: number; placeOfSupply: string | null; supplierStateCode: string | null;
    computedDueDate: string | null; dueDate: string | null;
    withholdingSection: { code: string; rate: string } | null };
};

export const listBills = (filters: Record<string, string | undefined> = {}) => get<{ rows: BillRow[] }>(`/supplier-bills${qs(filters)}`).then((result) => result.rows);
export const getBill = (id: string) => get<BillDetail>(`/supplier-bills/${id}`);
export const getBillOptions = () => get<{ options: BillOptions }>("/supplier-bills/options").then((result) => result.options);
export const getEligibility = (orderId: string, billId?: string) =>
  get<{ eligibility: Eligibility }>(`/supplier-bills/eligibility${qs({ order: orderId, bill: billId })}`).then((result) => result.eligibility);
export const getAging = (supplierId?: string) => get<{ rows: Array<Record<string, string>> }>(`/supplier-bills/aging${qs({ supplierId })}`).then((result) => result.rows);
export const previewBill = (input: Record<string, unknown>) => post<{ preview: BillPreview }>("/supplier-bills/preview", input).then((result) => result.preview);
export const createBill = (input: Record<string, unknown>) =>
  post<{ result: { id: string; billNumber: string; warnings: string[] } }>("/supplier-bills", input).then((result) => result.result);
export const updateBill = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string; warnings: string[] } }>(`/supplier-bills/${id}`, input).then((result) => result.result);
export const validateBill = (id: string) => get<{ validation: { ready: boolean; issues: string[]; warnings: string[] } }>(`/supplier-bills/${id}/validate`).then((result) => result.validation);
export const billAction = (id: string, action: "post" | "approve" | "cancel" | "reverse" | "payments" | "payments/complete" | "advance" | "credit", input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, string | null> }>(`/supplier-bills/${id}/${action}`, input).then((result) => result.result);
export const reversePayment = (paymentId: string, reason: string) => post<{ result: unknown }>(`/supplier-bills/payments/${paymentId}/reverse`, { reason });
export const voucherUrl = (id: string, inline = false) => `/api/documents/procurement.supplier_bill/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export type BillFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export const listBillFiles = (id: string) => get<{ files: BillFile[] }>(`/supplier-bills/${id}/files`).then((result) => result.files);
export const uploadBillFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: BillFile }>(`/supplier-bills/${id}/files`, { method: "POST", body: form });
};
export const removeBillFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/supplier-bills/${id}/files/${fileId}`, { method: "DELETE", body: "{}" });
export const billFileUrl = (id: string, fileId: string, inline = false) => `/api/procurement/supplier-bills/${id}/files/${fileId}${inline ? "?disposition=inline" : ""}`;
export const listWithholdingSections = () => get<{ sections: Array<{ id: string; code: string; name: string; rate: string; status: string }> }>("/withholding-sections").then((result) => result.sections);
export const saveWithholdingSection = (input: Record<string, unknown>) => post<{ section: unknown }>("/withholding-sections", input);
export const getSupplierRegistrations = (supplierId: string) =>
  get<{ registrations: Array<{ id: string; gstin: string; stateCode: string; stateName: string | null; status: string; isPrincipal: boolean }> }>(`/suppliers/${supplierId}/tax-registrations`)
    .then((result) => result.registrations.filter((row) => row.status === "active"));

export type SupplierBillDefaults = {
  supplierId: string; supplierNumber: string; supplierName: string; legalName: string; status: string; currencyCode: string | null; paymentTermId: string | null; paymentTermName: string | null;
  withholdingSection: { id: string; code: string; rate: string } | null; registrations: Array<{ id: string; gstin: string; stateCode: string; registrationType: string; principal: boolean }>;
  supplierTaxRegistrationId: string | null; unregistered: boolean; address: { id: string; label: string | null; line1: string; city: string; stateCode: string | null } | null;
  buyingRegistration: { id: string; name: string; gstin: string | null; stateCode: string | null } | null; warnings: string[];
};
export const getSupplierBillDefaults = (supplierId: string) => get<{ defaults: SupplierBillDefaults }>(`/supplier-bills/defaults${qs({ supplier: supplierId })}`).then((result) => result.defaults);
export type ExpenseCategory = { id: string; code: string; name: string; accountId: string; account: string | null; defaultTaxCategoryId: string | null; defaultHsnSac: string | null; status: string };
export const listExpenseCategories = () => get<{ categories: ExpenseCategory[] }>("/expense-categories").then((result) => result.categories);
export const saveExpenseCategory = (input: Record<string, unknown>) => post<{ category: ExpenseCategory }>("/expense-categories", input).then((result) => result.category);

// Partial supplier billing: the order's billing progress and a goods receipt's bill matching — derived from posted bills.
export type RelatedBill = {
  id: string; billNumber: string; type: "bill" | "vendor_credit"; supplierInvoiceNumber: string | null; status: string; documentStatus: string; paymentStatus: string; dueStatus: string;
  matchingResult: string; matchingBasis: string | null; billDate: string | null; postingDate: string | null; dueDate: string | null; currencyCode: string; quantity: string | null;
  amount: string | null; receipts: string[]; invoiceTotal: string; payable: string; paid: string; outstanding: string; href: string; twoWayResult: MatchResult; openDiscrepancies: number;
};
export type BillingProgress = {
  order: { id: string; purchaseOrderNumber: string; status: string; currencyCode: string; supplierId: string };
  status: string; statusLabel: string; matchingPolicy: { policy: string; label: string; basis: "receipt" | "order"; billHeldGoods: boolean; reason: string | null };
  totals: Record<"ordered" | "cancelled" | "received" | "committed" | "billed" | "remainingCommitment" | "eligibleNow" | "draftBilled", string>;
  readyToBill: boolean; warnings: string[];
  lines: Array<{ lineId: string; lineNumber: number; description: string; productType: string; uom: string | null; basis: "quantity" | "amount"; matching: string; receiptRequired: boolean;
    ordered: string; cancelled: string; received: string; accepted: string; held: string; returned: string; committed: string; billed: string; draftBilled: string; draftBills: string[];
    remainingCommitment: string; eligibleNow: string; overbilled: boolean; unitPrice: string; agreedAmount: string; billedAmount: string; remainingAmount: string; readyToBill: boolean }>;
  values: { committed: string; billed: string; unbilled: string; drafts: string } | null;
  bills: RelatedBill[] | null;
  payments: { invoiced: string; payable: string; paid: string; outstanding: string; bills: number } | null;
  matching?: { counts: Record<MatchResult, number>; issues: Array<{ id: string; billNumber: string; result: MatchResult; openDiscrepancies: number; href: string }> };
};
export type ReceiptBilling = {
  receipt: { id: string; receiptNumber: string; status: string; reversed: boolean; purchaseOrderId: string; purchaseOrderNumber: string };
  matchingPolicy: { policy: string; label: string; basis: "receipt" | "order"; billHeldGoods: boolean; reason: string | null };
  lines: Array<{ receiptLineId: string; purchaseOrderLineId: string; lineNumber: number; description: string; uom: string | null; accepted: string; held: string; rejected: string;
    billable: string; billed: string; draftBilled: string; remaining: string }>;
  bills: Array<{ id: string; billNumber: string; supplierInvoiceNumber: string | null; status: string; documentStatus: string; paymentStatus: string; matchingResult: string;
    billDate: string | null; quantity: string; href: string }> | null;
  canBill: boolean; note: string | null;
};
export const getOrderBilling = (orderId: string) => get<{ billing: BillingProgress }>(`/purchase-orders/${orderId}/billing`).then((result) => result.billing);
export const getReceiptBilling = (receiptId: string) => get<{ billing: ReceiptBilling }>(`/goods-receipts/${receiptId}/billing`).then((result) => result.billing);

// 2-Way Matching of a bill: the result, Check Matching (drafts) and accepting supported variances.
export const getBillMatching = (id: string) => get<{ matching: BillMatching }>(`/supplier-bills/${id}/matching`).then((result) => result.matching);
export const recheckBillMatching = (id: string) => post<{ matching: BillMatching }>(`/supplier-bills/${id}/matching`).then((result) => result.matching);
export const approveMatchException = (id: string, reason: string) =>
  post<{ matching: BillMatching }>(`/supplier-bills/${id}/matching/exceptions`, { reason }).then((result) => result.matching);
export const MATCH_LABELS: Record<MatchResult, string> = { matched: "Matched", mismatch: "Mismatch", approved_exception: "Approved exception", not_checked: "Not checked", not_applicable: "Not applicable" };
export const MATCH_TONES: Record<MatchResult, "success" | "danger" | "warning" | "neutral" | "info"> = { matched: "success", mismatch: "danger", approved_exception: "warning", not_checked: "info", not_applicable: "neutral" };
