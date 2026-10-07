"use client";

// Purchase orders, goods receipts, purchase returns and supplier quotations:
// the shapes the screens read, and the calls they make. Amounts and
// quantities are the server's decimal strings; nothing here calculates.
import { ProcApiError } from "@/features/procurement/shared/http";

export class PurchaseApiError extends ProcApiError {
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
  if (!response.ok || payload.ok === false) throw new PurchaseApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorCode = (error: unknown) => (error instanceof ProcApiError ? error.code : undefined);
export const issuesOf = (error: unknown): string[] => {
  if (!(error instanceof PurchaseApiError)) return [];
  const issues = (error.details.issues ?? (error.details.details as Record<string, unknown> | undefined)?.issues) as Array<{ message: string }> | undefined;
  const reasons = (error.details.reasons ?? (error.details.details as Record<string, unknown> | undefined)?.reasons) as string[] | undefined;
  return [...(issues ?? []).map((issue) => issue.message), ...(reasons ?? [])];
};

export type Address = { name?: string | null; label?: string | null; line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; stateCode?: string | null; stateName?: string | null;
  postalCode?: string | null; countryCode?: string | null; email?: string | null; phone?: string | null; gstin?: string | null; addressId?: string };
export type Contact = { relationshipId: string; name: string; designation: string | null; email: string | null; phone: string | null } | null;
export type Registration = { registrationId?: string; id?: string; gstin: string | null; stateCode: string | null; stateName?: string | null; name?: string; legalName?: string | null; address?: string | null } | null;

export type Tracking = {
  lifecycle: string; communication: string; receipt: string; billing: string; payment: string;
  payable: { status: string; total?: string; outstanding?: string };
  receivingComplete: boolean; openRejections: number; readyToReceive: boolean; readyToBill: boolean; readyToClose: boolean; closureBlockers: string[]; overdueReceipt: boolean; draftReceipts: number;
};
export type LineProgress = {
  lineId: string; lineNumber: number; receiptRequired: boolean; ordered: string; accepted: string; held: string; rejected: string; received: string; returned: string;
  cancelled: string; damaged: string; released: string; openInspection: string; openDamaged: string; netRetained: string; refusedAtDock: string; qualityRejected: string; rejectedFromStock: string; openRejections: number; billed: string; postedBilled: string; remainingToReceive: string; billable: string; remainingToBill: string; overbilled: boolean; draftReceipt: string;
};
export type OrderLine = {
  id: string; lineNumber: number; productType: "stock" | "non_stock" | "service"; productTypeLabel: string; productId: string | null;
  product: { code: string | null; name: string; descriptive?: boolean; trackingType?: string }; description: string; hsnSacCode: string | null; orderedQuantity: string; uomId: string;
  uom: { code: string; name: string }; unitPrice: string; priceSource: string; zeroPriceReason: string | null; discountType: string | null; discountValue: string; grossAmount: string;
  lineDiscount: string; allocatedDocumentDiscount: string; taxableAmount: string; taxCategoryId: string | null; taxTreatment: string; taxRate: string; taxTotal: string; lineTotal: string;
  warehouseId: string | null; warehouseName: string | null; expectedDeliveryDate: string | null; sourceQuotationLineId: string | null; expenseAccountId: string | null; expenseAccount: string | null;
  taxes: Array<{ type: string; label: string; rate: string; taxAmount: string }>; progress: LineProgress | null;
  receipts: Array<{ id: string; number: string; status: string; date: string; accepted: string; held: string; rejected: string }>;
  bills: Array<{ id: string; number: string; supplierInvoiceNumber: string | null; type: string; status: string; quantity: string; unitPrice?: string }>;
  cancellations: Array<{ quantity: string; reasonCode: string; reason: string | null; at: string; by: string | null }>;
};
export type OrderHeader = {
  id: string; purchaseOrderNumber: string; status: "draft" | "confirmed" | "closed" | "cancelled"; statusLabel: string; communicationStatus: string; communicationLabel: string;
  supplierId: string; supplierNumber: string; supplierName: string; supplier: { supplierName: string; supplierNumber: string; legalName?: string | null; gstin?: string | null };
  contact: Contact; orderingAddress: Address | null; billingAddress: Address | null; shipFrom: Address | null; supplierTaxRegistration: Registration; buyerRegistration: Registration;
  billTo: Address | null; shipTo: Address | null; paymentTerm: { name: string } | null; supplierContactId: string | null; supplierAddressId: string | null; supplierBillingAddressId: string | null;
  supplierShipFromId: string | null; supplierTaxRegistrationId: string | null; buyingRegistrationId: string | null; orderDate: string; expectedDeliveryDate: string | null;
  sourceQuotationId: string | null; sourceQuotationNumber: string | null; supplierQuotationReference: string | null; supplierReference: string | null; currencyCode: string;
  paymentTermId: string | null; buyerUserId: string | null; buyerName: string | null; defaultWarehouseId: string | null; defaultWarehouseName: string | null; priceMode: string;
  documentDiscountType: string | null; documentDiscountValue: string; documentDiscountAmount: string; grossTotal: string; lineDiscountTotal: string; taxableTotal: string; taxTotal: string;
  grandTotal: string; supplierNotes: string | null; internalNotes: string | null; revision: number; versionNumber: number; amendmentReason: string | null; amending: boolean;
  confirmedAt: string | null; confirmedByName: string | null; cancelledAt: string | null; cancelledByName: string | null; cancelReasonCode: string | null; cancelReason: string | null;
  closedAt: string | null; closedByName: string | null; closeReason: string | null; lastSentAt: string | null; lastSentTo: string | null; acknowledgedAt: string | null;
  acknowledgementReference: string | null; createdAt: string; createdByName: string | null;
  matchingPolicy: "three_way_accepted" | "three_way_received" | "two_way" | null; matchingPolicyLabel: string | null; matchingPolicyReason: string | null; matchingPolicyChangedAt: string | null;
};
export type DocumentLink = { id: string; number: string; status?: string; date?: string; href: string | null };
// The order's payment terms: the agreed term, the advance it expects and where that stands, and the statutory warning (MSMED Act).
export type PaymentTermsView = {
  orderId: string; paymentTerm: { id: string; code: string; name: string; termTypeLabel: string; summary: string; version: number } | null; paymentAgreement: string | null;
  advance: { percentage: string; amount: string | null; requested?: string; paid?: string; allocated?: string; unapplied?: string; remaining?: string;
    payments?: Array<{ id: string; number: string; date: string; amount: string; unapplied: string; status: string }> } | null;
  notes: string | null; changeReason: string | null; statutory: { statutoryDays: number; exceeds: boolean; message: string | null; classification: string; basis: string } | null;
  actions: { recordAdvance: boolean };
};
export type PurchaseOrderDetail = {
  order: OrderHeader; lines: OrderLine[]; tracking: Tracking & { lines: LineProgress[] };
  confirmations: Array<{ id: string; version: number; amendmentReason: string | null; grandTotal: string; confirmedAt: string; confirmedBy: string | null; supersededAt: string | null; current: boolean }>;
  communications: Array<{ id: string; kind: string; version: number; channel: string; recipients: string | null; subject: string | null; note: string | null; at: string; by: string | null }>;
  related: {
    quotation: DocumentLink | null;
    receipts: Array<DocumentLink & { deliveryNote: string | null; accepted: string; held: string; rejected: string }>;
    bills: Array<DocumentLink & { supplierInvoiceNumber: string | null; type: string; matchingStatus: string; currencyCode: string; total?: string; outstanding?: string }>;
    vendorCredits: Array<DocumentLink & { supplierInvoiceNumber: string | null; type: string; currencyCode: string; total?: string }>;
    returns: Array<DocumentLink & { reason: string; receiptNumber: string; quantity: string; replacementNumber?: string | null }>;
    payments: Array<DocumentLink & { amount: string; currencyCode: string }>;
  };
  rejections: { cases: RejectionRow[]; summary: RejectionSummary } | null;
  paymentTerms?: PaymentTermsView;
  history: Array<{ id: string; type: string; summary: string; at: string; actor: string | null }>;
  actions: Record<"edit" | "confirm" | "amend" | "cancel" | "cancelRemaining" | "close" | "send" | "acknowledge" | "receive" | "bill" | "returnGoods" | "updateDates" | "changeWarehouse" | "print" | "attach" | "recordRejection" | "changeMatchingPolicy", boolean>;
  capabilities: Record<string, boolean>;
  canSeeAmounts: boolean;
};
export type PurchaseOrderRow = {
  id: string; purchaseOrderNumber: string; status: string; statusLabel: string; communicationStatus: string; supplierId: string; supplierNumber: string; supplierName: string; orderDate: string;
  expectedDeliveryDate: string | null; grandTotal: string; currencyCode: string; buyerUserId: string | null; buyerName: string | null; versionNumber: number; supplierReference: string | null;
  receiptStatus: string; receiptLabel: string; billingStatus: string; billingLabel: string; readyToReceive: boolean; readyToBill: boolean; readyToClose: boolean; overdueReceipt: boolean;
  needsAttention: boolean; openRejections: number;
};
type Coded = { code: string; label: string };
export type PurchaseOrderOptions = {
  views: Array<{ key: string; label: string }>; cancelReasons: Coded[]; sentChannels: Coded[]; statusLabels: Record<string, string>; receiptLabels: Record<string, string>;
  billingLabels: Record<string, string>; paymentLabels: Record<string, string>; communicationLabels: Record<string, string>; productTypeLabels: Record<string, string>;
  settings: { billingBasis: "receipt" | "order"; requireExpectedDate: boolean; defaultWarehouseId: string | null; billHeldGoods: boolean; postReceiptAccrual: boolean };
  suppliers: Array<{ id: string; supplier_number: string; name: string; status: string; currency_code: string }>;
  products: Array<{ id: string; code: string; name: string; item_type: string; track_inventory: boolean; purchase_uom_id: string | null; uom_id: string | null; last_purchase_price: string | null; tax_category_id: string | null }>;
  uoms: Array<{ id: string; code: string; name: string; decimal_places: number }>; warehouses: Array<{ id: string; code: string; name: string }>;
  currencies: Array<{ code: string; name: string }>; paymentTerms: Array<{ id: string; code: string; name: string; term_type?: string; advance_percentage?: string | null; is_default?: boolean }>;
  registrations: Array<{ id: string; code: string; name: string; gstin: string | null; state_code: string | null; is_default: boolean }>;
  taxCategories: Array<{ id: string; code: string; name: string }>; expenseAccounts: Array<{ id: string; code: string; name: string }>; buyers: Array<{ id: string; name: string }>;
  capabilities: Record<string, boolean>;
};
export type Preview = {
  warnings: Array<{ line: number; code: string; message: string }>; supplyType: string;
  totals: Record<string, string | null>;
  lines: Array<{ lineNumber: number; productType: string; description: string; quantity: string; uomCode: string; unitPrice: string | null; gross: string; lineDiscount: string;
    allocatedDocumentDiscount: string; taxableAmount: string; taxTreatment: string; taxRate: string; taxTotal: string; lineTotal: string;
    components: Array<{ type: string; label: string; rate: string; taxAmount: string }> }>;
  supplier: { supplierName: string; gstin?: string | null }; currencyCode: string; paymentTerm: { id: string; name: string } | null; contact: Contact; orderingAddress: Address | null;
  billingAddress: Address | null; shipFrom: Address | null; supplierTaxRegistration: Registration; buyerRegistration: Registration; billTo: Address | null; shipTo: Address | null;
  buyerUserId: string | null; defaultWarehouseId: string | null;
};

// Purchase orders
export type OrderFilters = Record<string, string | number | undefined>;
export const listPurchaseOrders = (filters: OrderFilters) =>
  get<{ rows: PurchaseOrderRow[]; total: number; views: Array<{ key: string; label: string }> }>(`/purchase-orders${qs(filters)}`);
export const getPurchaseOrderOptions = () => get<{ options: PurchaseOrderOptions }>("/purchase-orders/options").then((result) => result.options);
export const getPurchaseOrder = (id: string) => get<PurchaseOrderDetail>(`/purchase-orders/${id}`);
export const getSupplierDefaults = (supplierId: string, productIds: string[] = []) =>
  get<{ defaults: { supplier: Record<string, unknown> | null; products: Array<{ id: string; suggestedPrice: string | null; uomId: string | null; productType: string }>; today: string } }>(
    `/purchase-orders/defaults${qs({ supplierId, productIds: productIds.join(",") })}`).then((result) => result.defaults);
export const previewPurchaseOrder = (input: Record<string, unknown>) => post<{ preview: Preview }>("/purchase-orders/preview", input).then((result) => result.preview);
export const createPurchaseOrder = (input: Record<string, unknown>) =>
  post<{ result: { id: string; purchaseOrderNumber: string; warnings: Array<{ message: string }>; similarOrders: Array<{ id: string; number: string; status: string }> } }>("/purchase-orders", input)
    .then((result) => result.result);
export const updatePurchaseOrder = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string; revision: number } }>(`/purchase-orders/${id}`, input).then((result) => result.result);
export const orderAction = (id: string, action: string, input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, unknown> }>(`/purchase-orders/${id}/${action}`, input).then((result) => result.result);
export const changeLineWarehouse = (id: string, lineId: string, input: Record<string, unknown>) =>
  post<{ result: Record<string, unknown> }>(`/purchase-orders/${id}/lines/${lineId}/warehouse`, input).then((result) => result.result);
export const purchaseOrderPdfUrl = (id: string, { version, inline }: { version?: number; inline?: boolean } = {}) =>
  `/api/documents/procurement.purchase_order/${id}/pdf${qs({ version, disposition: inline ? "inline" : undefined })}`;
export const getPurchasingSettings = () => get<{ settings: PurchaseOrderOptions["settings"] }>("/purchase-orders/settings").then((result) => result.settings);
export const updatePurchasingSettings = (input: Record<string, unknown>) =>
  patch<{ settings: PurchaseOrderOptions["settings"] }>("/purchase-orders/settings", input).then((result) => result.settings);

// Files
export type OrderFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export const listOrderFiles = (id: string) => get<{ files: OrderFile[] }>(`/purchase-orders/${id}/files`).then((result) => result.files);
export const uploadOrderFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: OrderFile }>(`/purchase-orders/${id}/files`, { method: "POST", body: form });
};
export const removeOrderFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/purchase-orders/${id}/files/${fileId}`, { method: "DELETE", body: "{}" });
export const orderFileUrl = (id: string, fileId: string) => `/api/procurement/purchase-orders/${id}/files/${fileId}`;

// Goods receipts
export type Disposition = { id: string; disposition: "inspection_hold" | "damaged"; quantity: string; released: string; returned: string; open: string;
  inspection: { id: string; number: string; status: string } | null };
export type ReceiptLine = {
  id: string; lineNumber: number; purchaseOrderLineId: string; orderLineNumber: number; productId: string | null; product: { code?: string | null; name?: string }; productType: string;
  description: string; uom: { code: string }; orderedQuantity: string; receivedQuantity: string; acceptedQuantity: string; inspectionQuantity: string; damagedQuantity: string;
  heldQuantity: string; refusedQuantity: string; refusalReason: string | null; refusalReasonCode: string | null; presentedQuantity: string | null; baseQuantity: string; conversionFactor: string; warehouseId: string | null; warehouseName: string | null;
  warehouseLocationId: string | null; locationCode: string | null; holdLocationCode: string | null; batchNumber: string | null; expiryDate: string | null; manufacturedDate: string | null;
  trackingType: string; requiresExpiryDate: boolean; serialNumbers: string[]; discrepancyNotes: string | null; unitCost: string | null; returned: string;
  returnedFromStock: string; netRetained: string; billable: string | null; billed: string | null; dispositions: Disposition[];
};
export type GoodsReceiptDetail = {
  receipt: {
    id: string; receiptNumber: string; status: "draft" | "posted" | "cancelled" | "reversed"; purchaseOrderId: string; purchaseOrderNumber: string; orderStatus: string; supplierId: string;
    supplierName: string; company: Registration; warehouseId: string | null; warehouseName: string | null; receiptDate: string; supplierChallanNumber: string | null;
    supplierChallanDate: string | null; shipFrom: Address | null; notes: string | null; createdAt: string; createdByName: string | null; updatedAt: string; postedAt: string | null;
    postedByName: string | null; cancelledAt: string | null; cancelReason: string | null; reversedAt: string | null; reversedByName: string | null; reversalReason: string | null;
    physicalReceivedAt: string | null; vehicleNumber: string | null; carrierName: string | null; trackingReference: string | null; receivedByUserId: string | null; receivedByName: string | null;
    currencyCode: string | null;
    accrual: { journalEntryId: string; entryNumber: string; amount: string; reversalJournalEntryId: string | null; reversalEntryNumber: string | null } | null;
  };
  lines: ReceiptLine[];
  movements: Array<{ id: string; number: string; type: string; quantity: string; unitCost: string | null; at: string; warehouseName: string | null; locationCode: string | null; reason: string | null }>;
  billMatching: Array<{ lineNumber: number | null; quantity: string; billId: string; billNumber: string; supplierInvoiceNumber: string | null; status: string }>;
  returns: Array<{ id: string; number: string; date: string; reason: string; replacementPurchaseOrderId: string | null; replacementNumber: string | null }>;
  discrepancies: Array<{ id: string; lineNumber: number | null; type: string; label: string; quantity: string | null; notes: string; at: string; by: string | null;
    evidence: Array<{ id: string; fileName: string }> }>;
  reconciliation: Reconciliation | null;
  showCost: boolean;
  rejections: RejectionRow[];
  rejectable: Array<{ goodsReceiptLineId: string; usable: string; holds: Array<{ dispositionId: string; undecided: string; qualityInspectionId: string | null }> }>;
  history: Array<{ id: string; type: string; summary: string; at: string; actor: string | null }>;
  discrepancyTypes: Array<{ code: string; label: string }>;
  actions: Record<"edit" | "post" | "preview" | "cancel" | "reverse" | "returnGoods" | "release" | "recordDiscrepancy" | "attach" | "print" | "recordRejection" | "recordQualityRejection" | "createBill", boolean>;
};
export type Reconciliation = { receiptId: string; status: string; matched: boolean;
  lines: Array<{ lineId: string; lineNumber: number; description: string; expectedBaseQuantity: string; postedBaseQuantity: string; difference: string; matched: boolean }> };
export type GoodsReceiptRow = { id: string; receiptNumber: string; status: string; receiptDate: string; supplierChallanNumber: string | null; purchaseOrderId: string; purchaseOrderNumber: string;
  supplierName: string; warehouseName: string | null; lineCount: number; receivedById: string | null; receivedBy: string | null; physicalReceivedAt: string | null; openRejections: number };
export type Receivable = {
  order: { id: string; purchaseOrderNumber: string; status: string; supplierId: string; supplierName: string; supplierNumber: string | null; company: Registration; shipFrom: Address | null;
    defaultWarehouseId: string | null; expectedDeliveryDate: string | null };
  lines: Array<{ purchaseOrderLineId: string; lineNumber: number; productId: string | null; product: { code?: string | null; name?: string }; description: string; productType: string;
    trackingType: string; requiresExpiryDate: boolean; uom: { code: string }; uomDecimals: number; warehouseId: string | null; receiptRequired: boolean; ordered: string; received: string; cancelled: string; remaining: string;
    returned: string; onOtherDrafts: string; otherDrafts: Array<{ id: string; number: string; quantity: string }>;
    uomId: string | null; conversionFactor: string | null; baseUom: string | null; remainingBase: string | null;
    units: Array<{ uomId: string; code: string; factor: string; decimals: number; isBase: boolean }> }>;
};
export const getReceivable = (orderId: string, exceptReceiptId?: string) =>
  get<{ receivable: Receivable }>(`/purchase-orders/${orderId}/receivable${qs({ exceptReceiptId })}`).then((result) => result.receivable);
export const createGoodsReceipt = (orderId: string, input: Record<string, unknown>) =>
  post<{ result: { id: string; receiptNumber: string; status: string } }>(`/purchase-orders/${orderId}/receipts`, input).then((result) => result.result);
export const listGoodsReceipts = (filters: Record<string, string | undefined> = {}) => get<{ rows: GoodsReceiptRow[] }>(`/goods-receipts${qs(filters)}`).then((result) => result.rows);
export const getGoodsReceipt = (id: string) => get<GoodsReceiptDetail>(`/goods-receipts/${id}`);
export const validateGoodsReceipt = (id: string) => get<{ validation: { ready: boolean; issues: string[] } }>(`/goods-receipts/${id}/validate`).then((result) => result.validation);
export const updateGoodsReceipt = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string } }>(`/goods-receipts/${id}`, input);
export const receiptAction = (id: string, action: "post" | "cancel" | "reverse", input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, unknown> }>(`/goods-receipts/${id}/${action}`, input).then((result) => result.result);
export const recordDiscrepancy = (id: string, input: Record<string, unknown>) => post<{ result: { id: string } }>(`/goods-receipts/${id}/discrepancies`, input);
export const releaseHeld = (dispositionId: string, input: Record<string, unknown>) =>
  post<{ result: { released: string } }>(`/goods-receipts/dispositions/${dispositionId}/release`, input).then((result) => result.result);
export const goodsReceiptPdfUrl = (id: string, inline = false) => `/api/documents/procurement.goods_receipt/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const getReconciliation = (id: string) => get<Reconciliation>(`/goods-receipts/${id}/reconciliation`);
export const listReceiptFiles = (id: string) => get<{ files: OrderFile[] }>(`/goods-receipts/${id}/files`).then((result) => result.files);
export const uploadReceiptFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: OrderFile }>(`/goods-receipts/${id}/files`, { method: "POST", body: form });
};
export const removeReceiptFile = (id: string, fileId: string) => call<{ result: { removed: boolean } }>(`/goods-receipts/${id}/files/${fileId}`, { method: "DELETE", body: "{}" });
export const receiptFileUrl = (id: string, fileId: string) => `/api/procurement/goods-receipts/${id}/files/${fileId}`;
export const getReceivingAccess = () =>
  get<{ warehouses: Array<{ warehouseId: string; code: string; name: string; userIds: string[] }> }>("/purchase-orders/receiving-access").then((result) => result.warehouses);
export const setReceivingAccess = (warehouseId: string, userIds: string[]) => call<{ result: unknown }>("/purchase-orders/receiving-access", { method: "PUT", body: JSON.stringify({ warehouseId, userIds }) });

// Supplier quotations
export type QuotationRow = { id: string; quotationNumber: string; status: string; quotationDate: string; validUntil: string | null; currencyCode: string; supplierReference: string | null;
  supplierName: string; grossValue: string; purchaseOrderId: string | null; purchaseOrderNumber: string | null };
export type QuotationDetail = {
  quotation: { id: string; quotationNumber: string; supplierId: string; supplierName: string; supplierNumber: string; supplierReference: string | null; rfqReference: string | null;
    quotationDate: string; validUntil: string | null; currencyCode: string; paymentTermId: string | null; paymentTermName: string | null; priceMode: string; documentDiscountType: string | null;
    documentDiscountValue: string; deliveryLeadDays: number | null; notes: string | null; status: string; convertedPurchaseOrderId: string | null; convertedPurchaseOrderNumber: string | null; expired: boolean };
  lines: Array<{ id: string; lineNumber: number; productId: string; productCode: string; productName: string; description: string | null; quantity: string; uomId: string | null; uomCode: string | null;
    unitPrice: string; discountType: string | null; discountValue: string; taxCategoryId: string | null }>;
  actions: { edit: boolean; convert: boolean; cancel: boolean };
};
export const listQuotations = (filters: Record<string, string | undefined> = {}) => get<{ rows: QuotationRow[] }>(`/supplier-quotations${qs(filters)}`).then((result) => result.rows);
export const getQuotation = (id: string) => get<QuotationDetail>(`/supplier-quotations/${id}`);
export const createQuotation = (input: Record<string, unknown>) => post<{ result: { id: string; quotationNumber: string } }>("/supplier-quotations", input).then((result) => result.result);
export const updateQuotation = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string } }>(`/supplier-quotations/${id}`, input).then((result) => result.result);
export const cancelQuotation = (id: string) => post<{ result: { id: string } }>(`/supplier-quotations/${id}/cancel`).then((result) => result.result);
export const convertQuotation = (id: string, input: Record<string, unknown> = {}) =>
  post<{ result: { id: string; purchaseOrderNumber: string; warnings: Array<{ message: string }> } }>(`/supplier-quotations/${id}/convert`, input).then((result) => result.result);

// Receiving rejections
export type RejectionRow = {
  id: string; rejectionNumber: string; status: "open" | "resolved" | "cancelled"; stage: "before_custody" | "after_custody"; stageLabel: string; source: string; sourceLabel: string;
  reason: string; reasonLabel: string; purchaseOrderId: string; purchaseOrderNumber: string; purchaseOrderLineId: string; goodsReceiptId: string | null; receiptNumber: string | null;
  supplierId: string; supplierName: string; warehouseName: string | null; description: string; product: { code?: string | null; name?: string }; uom: { code?: string };
  quantity: string; resolved: string; open: string; held: string; expectedResolution: string | null; observedAt: string; reportedBy: string | null; billMismatch: boolean;
};
export type ResolutionOption = { type: string; label: string; max: string; enabled: boolean; receipts?: Array<{ goodsReceiptLineId: string; receiptNumber: string; available: string }> };
export type RejectionDetail = {
  rejection: RejectionRow & {
    presentedQuantity: string | null; baseQuantity: string; conversionFactor: string; reasonTags: Array<{ code: string; label: string }>; explanation: string | null;
    deliveredProductDescription: string | null; batchNumber: string | null; expiryDate: string | null; serialNumbers: string[]; locationCode: string | null; sourceLocationCode: string | null;
    orderLineNumber: number; orderedQuantity: string; receiptLineNumber: number | null; receiptLineId: string | null; receiptReceivedQuantity: string | null;
    inspection: { id: string; number: string; status: string; accepted: string; rejected: string } | null; returned: string; released: string; disposed: string;
    expectedResolutionLabel: string | null; resolutionType: string | null; resolutionNotes: string | null; resolvedAt: string | null; resolvedByName: string | null;
    cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null; createdAt: string; createdByName: string | null; updatedAt: string;
  };
  resolutions: Array<{ id: string; type: string; label: string; quantity: string; notes: string; at: string; by: string | null; documentType: string | null; documentLabel: string | null;
    documentId: string | null; documentNumber: string | null }>;
  movements: Array<{ id: string; number: string; type: string; quantity: string; at: string; warehouseName: string | null; locationCode: string | null }>;
  files: Array<{ id: string; fileName: string; fromReceipt: boolean; uploadedAt: string }>;
  history: Array<{ id: string; type: string; summary: string; at: string; actor: string | null }>;
  financial: { billingBasis: string | null; billed: string; postedBilled: string; billable: string; mismatch: string | null; note: string | null;
    bills: Array<{ id: string; number: string; supplierInvoiceNumber: string | null; status: string; type: string; quantity: string }> } | null;
  resolution: { open: string; options: ResolutionOption[] };
  reasons: Array<{ code: string; label: string }>; expectedResolutions: Array<{ code: string; label: string }>;
  actions: Record<"edit" | "cancel" | "resolve" | "attach", boolean>;
};
export type RejectionSummary = { open: number; resolved: number; lines: Array<{ purchaseOrderLineId: string; refusedAtDock: string; rejectedAfterReceipt: string; open: number; resolved: number }> };
export const REJECTION_REASON_OPTIONS = [
  { value: "damaged_goods", label: "Damaged goods" }, { value: "defective_product", label: "Defective product" }, { value: "wrong_product", label: "Wrong product" },
  { value: "wrong_specification", label: "Wrong specification" }, { value: "poor_quality", label: "Poor quality" }, { value: "expired_product", label: "Expired product" },
  { value: "incorrect_quantity", label: "Incorrect quantity" }, { value: "packaging_damage", label: "Packaging damage" },
  { value: "missing_documentation", label: "Missing documentation" }, { value: "failed_inspection", label: "Failed inspection" }, { value: "other", label: "Other" },
];
export const listRejections = (filters: Record<string, string | undefined> = {}) => get<{ rows: RejectionRow[] }>(`/rejections${qs(filters)}`).then((result) => result.rows);
export const getRejection = (id: string) => get<RejectionDetail>(`/rejections/${id}`);
export const updateRejection = (id: string, input: Record<string, unknown>) => patch<{ result: { id: string } }>(`/rejections/${id}`, input);
export const resolveRejection = (id: string, input: Record<string, unknown>) => post<{ result: Record<string, unknown> }>(`/rejections/${id}/resolve`, input).then((result) => result.result);
export const returnRejection = (id: string, input: Record<string, unknown>) =>
  post<{ result: { returnId: string; returnNumber: string } }>(`/rejections/${id}/return`, input).then((result) => result.result);
export const cancelRejection = (id: string, reason: string) => post<{ result: { id: string } }>(`/rejections/${id}/cancel`, { reason });
export const recordDockRejection = (orderId: string, input: Record<string, unknown>) =>
  post<{ result: { cases: Array<{ id: string; rejectionNumber: string }> } }>(`/purchase-orders/${orderId}/rejections`, input).then((result) => result.result);
export const recordPostReceiptRejection = (receiptLineId: string, input: Record<string, unknown>) =>
  post<{ result: { id: string; rejectionNumber: string } }>(`/goods-receipts/lines/${receiptLineId}/rejections`, input).then((result) => result.result);
export const rejectFromInspection = (inspectionId: string) =>
  post<{ result: { id: string; rejectionNumber: string } }>(`/rejections/from-inspection/${inspectionId}`, {}).then((result) => result.result);
export const listRejectionFiles = (id: string) => get<{ files: OrderFile[] }>(`/rejections/${id}/files`).then((result) => result.files);
export const uploadRejectionFile = (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: OrderFile }>(`/rejections/${id}/files`, { method: "POST", body: form });
};
export const getInspectionRejections = (inspectionId: string) =>
  get<{ inspection: { linked: boolean; decided: boolean; canRecord: boolean; rows: RejectionRow[] } }>(`/rejections/inspection/${inspectionId}`).then((result) => result.inspection);
export const rejectionFileUrl = (id: string, fileId: string) => `/api/procurement/rejections/${id}/files/${fileId}`;
