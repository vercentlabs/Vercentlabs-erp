// Approval command catalogue: platform-owned metadata about every approval
// command a business module may raise. Pure data: no business-module imports.
// The executable approve/reject handlers live in
// services/api/src/orchestration/approvals/registry.js, which must register
// exactly these keys (verify:shared-runtime checks both directions).
//
// `payload` lists the required string fields of command_payload; `dedupeKey`
// derives the one-pending-request key (a document, a document version, or a
// specific POS discount) so legitimate versioned approvals stay possible.
const field = (name) => (payload) => String(payload[name]);

export const APPROVAL_COMMANDS = Object.freeze([
  { key: "accounting.customer_invoice.approve", moduleKey: "accounting", entityType: "accounting_customer_invoice", label: "Customer invoice approval", entityLabel: "Customer invoice", requiredPermission: "accounting.receivables.approve", payload: ["documentId", "contentHash"], dedupeKey: field("documentId") },
  { key: "accounting.vendor_bill.approve", moduleKey: "accounting", entityType: "accounting_vendor_bill", label: "Supplier invoice approval", entityLabel: "Supplier invoice", requiredPermission: "accounting.payables.approve", payload: ["documentId", "contentHash"], dedupeKey: field("documentId") },
  { key: "accounting.vendor_payment.approve", moduleKey: "accounting", entityType: "accounting_vendor_payment", label: "Supplier payment approval", entityLabel: "Supplier payment", requiredPermission: "accounting.payments.approve", payload: ["documentId", "contentHash"], dedupeKey: field("documentId") },
  { key: "accounting.journal.approve", moduleKey: "accounting", entityType: "accounting_journal_entry", label: "Journal approval", entityLabel: "Journal entry", requiredPermission: "accounting.journal.approve", payload: ["journalEntryId", "contentHash"], dedupeKey: field("journalEntryId") },
  { key: "accounting.budget.approve", moduleKey: "accounting", entityType: "accounting_budget", label: "Budget approval", entityLabel: "Budget", requiredPermission: "accounting.budget.manage", payload: ["budgetId"], dedupeKey: field("budgetId") },
  { key: "sales.quotation.approve", moduleKey: "sales", entityType: "sales_quotation", label: "Quotation approval", entityLabel: "Quotation", requiredPermission: "sales.quotation.approve", payload: ["quotationId", "quotationVersionId"], dedupeKey: (p) => `${p.quotationId}:${p.quotationVersionId}` },
  { key: "sales.order.approve", moduleKey: "sales", entityType: "sales_order", label: "Sales order approval", entityLabel: "Sales order", requiredPermission: "sales.order.approve", payload: ["orderId", "orderVersionId"], dedupeKey: (p) => `${p.orderId}:${p.orderVersionId}` },
  { key: "sales.order.amendment.approve", moduleKey: "sales", entityType: "sales_order_amendment", label: "Sales order amendment approval", entityLabel: "Sales order amendment", requiredPermission: "sales.order.approve", payload: ["orderId", "orderVersionId", "previousVersionId", "resumeStatus"], dedupeKey: field("orderVersionId") },
  { key: "pos.discount.approve", moduleKey: "point-of-sale", entityType: "pos_cart_discount", label: "Discount approval", entityLabel: "POS discount", requiredPermission: "pos.discount.approve", payload: ["discountApprovalId"], dedupeKey: field("discountApprovalId") },
  { key: "pos.payment.override.approve", moduleKey: "point-of-sale", entityType: "pos_payment", label: "Payment override approval", entityLabel: "POS payment", requiredPermission: "pos.payment.override", payload: ["paymentId"], dedupeKey: field("paymentId") },
]);

const BY_KEY = new Map(APPROVAL_COMMANDS.map((command) => [command.key, command]));

export function getApprovalCommand(key) {
  return BY_KEY.get(String(key || "")) || null;
}
