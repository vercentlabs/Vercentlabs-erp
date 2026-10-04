// Opportunity-to-Quotation Conversion: the opportunity starts a Draft Sales
// quotation in one server operation, and shows every quotation raised from it.
export { getQuotationReadiness, quotationCapabilities } from "./readiness.js";
export { createQuotationFromOpportunity } from "./convert.js";
export { listOpportunityQuotations, setPrimaryOpportunityQuotation } from "./list.js";
