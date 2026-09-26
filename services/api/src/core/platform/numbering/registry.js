// The one registry of document types that can be numbered. Every
// nextDocumentNumber() caller names a registered type (or a registered
// family, for module-owned partitions such as one receipt series per POS
// terminal); an unregistered type fails closed.
//
//   scope "organization"  one counter per organisation. Used by the document
//                         families whose identifiers are unique per
//                         organisation (CRM codes, Sales, Accounting,
//                         Procurement); they were issued by the retired
//                         public.numbering_series and keep their format.
//   scope "company"       one counter per company (every newer module).
//
// `configurable: false` marks types whose format a module owns in its own
// settings (a POS store's receipt prefix, HR's employee-number prefix):
// Settings > Numbering shows them read-only.
const org = (key, moduleKey, label, prefix, padding = 5) => ({ key, moduleKey, label, scope: "organization", defaultPrefix: prefix, defaultPadding: padding, configurable: true });
const co = (key, moduleKey, label, prefix, extra = {}) => ({ key, moduleKey, label, scope: "company", defaultPrefix: `${prefix}-`, defaultPadding: 6, configurable: true, ...extra });

export const DOCUMENT_TYPES = Object.freeze(
  [
    // CRM / shared business data (legacy organisation-wide series)
    org("crm_lead", "crm", "Lead", "LEAD-"),
    org("crm_opportunity", "crm", "Opportunity", "OPP-"),
    org("crm_campaign", "crm", "Campaign", "CMP-"),
    org("business_party", "crm", "Account / business party", "PTY-"),
    // Sales
    org("quotation", "sales", "Sales quotation", "QUO-"),
    org("sales_order", "sales", "Sales order", "SO-"),
    org("sales_fulfillment_request", "sales", "Fulfilment request", "FUL-"),
    org("sales_invoice_request", "sales", "Invoice request", "SIR-"),
    // Accounting
    org("journal_entry", "accounting", "Journal entry", "JE-"),
    org("customer_invoice", "accounting", "Customer invoice", "INV-"),
    org("customer_credit_note", "accounting", "Customer credit note", "CRN-"),
    org("customer_receipt", "accounting", "Customer receipt", "RCT-"),
    org("vendor_bill", "accounting", "Vendor bill", "BILL-"),
    org("vendor_credit_note", "accounting", "Vendor credit note", "VCN-"),
    org("vendor_payment", "accounting", "Vendor payment", "PAY-"),
    org("bank_statement", "accounting", "Bank statement", "STMT-"),
    org("fixed_asset", "accounting", "Fixed asset (accounting)", "FA-"),
    org("accounting_close_run", "accounting", "Period close run", "CLS-"),
    org("accounting_revaluation_run", "accounting", "FX revaluation run", "FXR-"),
    org("accounting_compliance_request", "accounting", "Compliance request", "CMP-"),
    org("accounting_cash_forecast", "accounting", "Cash forecast", "CF-"),
    // Procurement (organisation-wide; previously legacy series with a per-company fallback)
    org("purchase_requisition", "procurement", "Purchase requisition", "PR-", 6),
    org("sourcing_event", "procurement", "Sourcing event (RFQ)", "RFQ-", 6),
    org("procurement_agreement", "procurement", "Purchase agreement", "AGR-", 6),
    org("purchase_order", "procurement", "Purchase order", "PO-", 6),
    org("goods_receipt", "procurement", "Goods receipt", "GRN-", 6),
    org("service_entry", "procurement", "Service entry", "SE-", 6),
    org("return_to_vendor", "procurement", "Return to vendor", "RTV-", 6),
    org("procurement_match_exception", "procurement", "Invoice match exception", "MATCH-", 6),
    // Stock
    co("stock_movement", "stock", "Stock movement", "STK"),
    co("stock_transfer", "stock", "Stock transfer", "TRF"),
    co("stock_pick_list", "stock", "Pick list", "PCK"),
    co("stock_count", "stock", "Stock count", "CNT", { configurable: false }),
    // Assets
    co("asset", "assets", "Asset", "AST", { configurable: false }),
    co("asset_calibration", "assets", "Asset calibration", "CAL"),
    co("asset_depreciation_run", "assets", "Depreciation run", "DEP"),
    co("asset_disposal", "assets", "Asset disposal", "DSP"),
    co("asset_inspection", "assets", "Asset inspection", "INS"),
    co("asset_maintenance_order", "assets", "Maintenance order", "AMO"),
    co("asset_transfer", "assets", "Asset transfer", "ATR"),
    co("asset_value_adjustment", "assets", "Asset value adjustment", "ADJ"),
    co("asset_verification", "assets", "Asset verification", "VER"),
    // Projects
    co("project", "projects", "Project", "PRJ"),
    co("project_billing", "projects", "Project billing", "PBL"),
    co("project_issue", "projects", "Project issue", "ISS"),
    co("project_risk", "projects", "Project risk", "RSK"),
    co("project_task", "projects", "Project task (per project)", "TASK", { family: true, configurable: false }),
    // Manufacturing
    co("manufacturing_work_order", "manufacturing", "Work order", "WO"),
    co("manufacturing_mrp_run", "manufacturing", "MRP run", "MRP"),
    co("manufacturing_engineering_change", "manufacturing", "Engineering change", "ECN"),
    // Quality
    co("quality_inspection", "quality", "Inspection", "QI"),
    co("quality_hold", "quality", "Quality hold", "QH"),
    co("quality_nonconformance", "quality", "Non-conformance", "NC"),
    co("quality_capa", "quality", "CAPA", "CAPA"),
    co("quality_audit", "quality", "Quality audit", "QA"),
    co("quality_document", "quality", "Controlled document", "QD"),
    co("quality_calibration", "quality", "Calibration", "CAL"),
    co("quality_certificate", "quality", "Certificate of analysis", "COA"),
    co("quality_complaint", "quality", "Customer complaint", "CC"),
    // Support
    co("support_ticket", "support", "Support ticket", "TKT"),
    co("support_knowledge_article", "support", "Knowledge article", "KB"),
    co("support_entitlement", "support", "Entitlement", "ENT"),
    // HR & Payroll
    co("hr_employee", "hr-payroll", "Employee", "EMP", { configurable: false }),
    co("hr_candidate", "hr-payroll", "Candidate", "CAN"),
    co("hr_job_opening", "hr-payroll", "Job opening", "JOB"),
    co("hr_offer", "hr-payroll", "Offer", "OFR"),
    co("hr_expense", "hr-payroll", "Expense claim", "EXP"),
    co("hr_loan", "hr-payroll", "Loan / advance", "LN", { configurable: false }),
    co("hr_payroll_run", "hr-payroll", "Payroll run", "PAY"),
    co("hr_bank_file", "hr-payroll", "Bank file", "BNK"),
    co("hr_final_settlement", "hr-payroll", "Final settlement", "FS"),
    // Point of sale (formats owned by store / terminal settings)
    co("pos_receipt", "point-of-sale", "POS receipt", "RCPT", { configurable: false }),
    co("pos_return", "point-of-sale", "POS return", "RET", { configurable: false }),
    co("pos_cash_movement", "point-of-sale", "Cash movement", "CASH", { configurable: false }),
    co("pos_day_end_report", "point-of-sale", "Day-end report", "ZREP", { configurable: false }),
    co("pos_day_end_correction", "point-of-sale", "Day-end correction", "ZCORR", { configurable: false }),
    co("pos_reconciliation", "point-of-sale", "Reconciliation", "RECN", { configurable: false }),
    co("pos_reconciliation_correction", "point-of-sale", "Reconciliation correction", "RCORR", { configurable: false }),
    co("pos_shift", "point-of-sale", "Shift (per terminal)", "SHIFT", { family: true, configurable: false }),
  ].map((entry) => Object.freeze(entry)),
);

const BY_KEY = new Map(DOCUMENT_TYPES.map((entry) => [entry.key, entry]));

// "project_task:<uuid>" resolves to the project_task family.
export function getDocumentType(documentType) {
  const key = String(documentType || "");
  if (BY_KEY.has(key)) return BY_KEY.get(key);
  const family = BY_KEY.get(key.split(":")[0]);
  return family?.family && key.includes(":") ? family : null;
}

export const RESET_POLICIES = Object.freeze(["never", "calendar_year", "fiscal_year"]);
