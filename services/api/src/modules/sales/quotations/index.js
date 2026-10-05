// Quotations (Sales): a priced offer to a customer, from Draft to an
// accepted offer that becomes a Sales Order.
export { QUOTATION_PERMISSIONS, QUOTATION_VIEWS, QuotationError, STATUS as QUOTATION_STATUS, STATUS_LABELS as QUOTATION_STATUS_LABELS } from "./constants.js";
export {
  addQuotationNote, createQuotation, createQuotationRevision, duplicateQuotation, exportQuotations, getQuotation, getQuotationDefaults, listQuotations, updateQuotation,
} from "./records.js";
export {
  approveQuotation, cancelQuotation, confirmQuotation, emailQuotation, markQuotationSent, recordQuotationDecision, rejectQuotationApproval,
} from "./lifecycle.js";
export { createSalesOrderFromQuotation } from "./order.js";
export { QUOTATION_FILE_ENTITY, listQuotationFiles, prepareQuotationFileUpload, readQuotationFile, removeQuotationFile, uploadQuotationFile } from "./files.js";
