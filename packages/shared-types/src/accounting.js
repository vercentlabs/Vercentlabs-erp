export const ACCOUNTING_JOURNAL_STATUSES = Object.freeze([
  "draft", "pending_approval", "approved", "posted", "rejected", "reversed", "cancelled",
]);
export const ACCOUNTING_INVOICE_STATUSES = Object.freeze([
  "draft", "pending_approval", "approved", "posted", "partially_paid", "paid", "overdue", "disputed", "cancelled", "reversed",
]);
export const ACCOUNTING_PAYMENT_STATUSES = Object.freeze([
  "draft", "pending_approval", "approved", "posted", "partially_applied", "applied", "reversed", "cancelled",
]);
export const ACCOUNTING_REPORT_KEYS = Object.freeze([
  "trial-balance", "general-ledger", "journal-register", "profit-and-loss", "balance-sheet", "cash-flow",
  "aged-receivables", "aged-payables", "customer-statement", "supplier-statement", "tax-summary",
  "bank-reconciliation", "budget-vs-actual", "cash-flow-forecast", "foreign-currency-exposure", "close-status", "subledger-reconciliation",
]);
export const ACCOUNTING_COMMAND_KEYS = Object.freeze({
  approveJournal: "accounting.journal.approve",
  approveBudget: "accounting.budget.approve",
  approveCustomerInvoice: "accounting.customer_invoice.approve",
  approveVendorBill: "accounting.vendor_bill.approve",
  approveVendorPayment: "accounting.vendor_payment.approve",
});
