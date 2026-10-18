// Email on CRM records: inbound email to lead (inbound.js, plan 3.1); email from records, templates and settings (outbound.js,
// templates.js, plan 4.1).
export { crmInboundAuthority, deliverInboundEmailToCrm } from "./inbound.js";
export {
  EMAIL_PLACEHOLDERS, EMAIL_RECORD_TYPES, fillPlaceholders, listRecordEmails, prepareRecordEmail, recordQuotationEmailOnDeal, sendRecordEmail,
} from "./outbound.js";
export { createEmailTemplate, getCrmEmailSettings, listEmailTemplates, saveCrmEmailSettings, updateEmailTemplate } from "./templates.js";
