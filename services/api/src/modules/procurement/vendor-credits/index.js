// Supplier Debit Notes & Vendor Credits: the buyer's commercial claim to a supplier (SDN-…) and the supplier's financial credit (VC-…) — separate
// records. Claims never touch the payable; credits are posted, applied and refunded through Finance.
export {
  CLAIM_STATUS_LABELS as DEBIT_CLAIM_STATUS_LABELS, CREDIT_ORIGINS as VENDOR_CREDIT_ORIGINS, CREDIT_REASONS as VENDOR_CREDIT_REASONS, TAX_TREATMENTS as VENDOR_CREDIT_TAX_TREATMENTS,
  VC_PERMISSIONS as VENDOR_CREDIT_PERMISSIONS, VC_VIEWS as VENDOR_CREDIT_VIEWS,
} from "./constants.js";
export {
  closeSupplierDebitClaim, createSupplierDebitClaim, getOpenSupplierClaims, getSupplierDebitClaim, getSupplierDebitClaims, issueDebitClaim, recordPartialClaimAcceptance,
  recordSupplierClaimResponse, updateDraftDebitClaim,
} from "./claims.js";
export {
  approveVendorCredit, calculateAvailableCreditEntitlement, calculateVendorCreditTaxes, calculateVendorCreditTotals, cancelDraftVendorCredit, checkDuplicateSupplierCreditNote,
  createCreditFromAcceptedClaim, createCreditFromPurchaseReturn, createCreditFromSupplierBill, createVendorCredit, postVendorCredit, reverseVendorCredit, updateDraftVendorCredit,
  validatePurchaseReturnCreditEligibility, validateSupplierCreditNote, validateVendorCreditForPosting, validateVendorCreditQuantities, validateVendorCreditSource,
} from "./credits.js";
export {
  allocateVendorCreditToBills, getSupplierCreditBalance, getVendorCreditAllocations, getVendorCreditAvailableBalance, getVendorCreditRefunds, recordSupplierRefund, reverseSupplierRefund,
  unapplyVendorCredit,
} from "./settlement.js";
export {
  getPurchaseReturnCreditProgress, getSupplierBillCreditSummary, getSupplierCreditStatement, getVendorCredit, getVendorCreditOptions, getVendorCredits, listDebitNotesAndCredits,
} from "./records.js";
