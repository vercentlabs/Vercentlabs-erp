// Payment Terms: the shared master for Sales, Procurement and Finance, and the one due-date and payment-schedule engine.
export {
  CALCULATION as PAYMENT_TERM_CALCULATION, CALCULATION_TYPES as PAYMENT_TERM_CALCULATION_TYPES, MAX_NET_DAYS as PAYMENT_TERM_MAX_NET_DAYS, PaymentTermRuleError,
  REFERENCE_BASES as PAYMENT_TERM_REFERENCE_BASES, RULE_KINDS as PAYMENT_TERM_RULE_KINDS, TERM_TYPES as PAYMENT_TERM_TYPES, calculateDueDate, calculateInstallmentAmounts,
  calculatePaymentDueDate, companyToday, describeRules as describePaymentTermRules, dueDateForRule, generatePaymentSchedule, readTermSnapshot, resolveDefaultPaymentTerm, snapshotOfTerm,
  validateInstallmentPercentages, validatePaymentTermRules,
} from "./terms.js";
export {
  PAYMENT_TERM_PERMISSIONS, PaymentTermError, activatePaymentTerm, createPaymentTerm, deactivatePaymentTerm, getPaymentTerm, getPaymentTerms, getSupplierDefaultPaymentTerm, listPaymentTerms,
  listPurchaseTermOptions, listSalesTermOptions, previewPaymentTerm, purchaseTermSnapshot, salesTermSnapshot, setDefaultPurchasePaymentTerm, setDefaultSalesPaymentTerm, updatePaymentTerm,
  versionPaymentTerm,
} from "./records.js";
