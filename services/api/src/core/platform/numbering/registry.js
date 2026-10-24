// The one registry of document types that can be numbered. Every
// nextDocumentNumber() caller names a registered type (or a registered
// family, for module-owned partitions such as one receipt series per POS
// terminal); an unregistered type fails closed.
//
// Every type keeps one counter per organisation. The older families (CRM
// codes, Sales, Accounting, Procurement) were issued by the retired
// public.numbering_series and keep their format: their prefix carries its own
// separator. Newer modules join a module-supplied prefix with "-".
//
// `gstDocument: true` marks the GST documents a company issues (invoices, credit notes): their number may be at most 16 characters
// (rule 46 of the CGST Rules), so a policy that could print a longer one is refused. With a GST registration, Accounting numbers them
// from the per-GSTIN financial-year series instead (core/invoicing).
//
// `configurable: false` marks types whose format a module owns in its own
// settings (a POS store's receipt prefix, HR's employee-number prefix):
// Settings > Numbering shows them read-only.
const org = (key, moduleKey, label, prefix, padding = 5) => ({ key, moduleKey, label, prefixSeparator: "", defaultPrefix: prefix, defaultPadding: padding, configurable: true });
const std = (key, moduleKey, label, prefix, extra = {}) => ({ key, moduleKey, label, prefixSeparator: "-", defaultPrefix: `${prefix}-`, defaultPadding: 6, configurable: true, ...extra });

export const DOCUMENT_TYPES = Object.freeze(
  [
    // CRM / shared business data (legacy organisation-wide series)
    org("crm_lead", "crm", "Lead", "LEAD-"),
    org("crm_opportunity", "crm", "Opportunity", "OPP-"),
    org("crm_task", "crm", "Task", "TSK-"),
    org("crm_follow_up", "crm", "Follow-up", "FUP-"),
    org("business_party", "crm", "Account", "ACC-"),
    org("crm_contact", "crm", "Contact", "CON-"),
    // A quotation or proforma sent from a deal when the organization has no Sales app (CRM audit M1).
    std("crm_quote", "crm", "CRM quotation", "QUO", { defaultResetPolicy: "calendar_year" }),
    std("crm_proforma", "crm", "CRM proforma", "PI", { defaultResetPolicy: "calendar_year" }),
    org("customer", "sales", "Customer", "CUS-", 6),
    // Sales
    std("quotation", "sales", "Sales quotation", "QT", { defaultResetPolicy: "calendar_year" }),
    std("sales_order", "sales", "Sales order", "SO", { defaultResetPolicy: "calendar_year" }),
    std("sales_fulfillment_request", "sales", "Delivery", "DEL", { defaultResetPolicy: "calendar_year" }),
    std("sales_return", "sales", "Sales return", "SRN", { defaultResetPolicy: "calendar_year" }),
    // A dispatch document without the Stock app (Sales audit).
    std("sales_challan", "sales", "Delivery challan", "DC", { defaultResetPolicy: "calendar_year" }),
    // GST on advances (Sales report Phase 2): the receipt voucher for an advance (Rule 50) and the refund voucher when it is returned (Rule 51).
    { ...std("sales_receipt_voucher", "sales", "Receipt voucher (advance)", "RV", { defaultResetPolicy: "fiscal_year" }), gstDocument: true },
    { ...std("sales_refund_voucher", "sales", "Refund voucher (advance)", "RFV", { defaultResetPolicy: "fiscal_year" }), gstDocument: true },
    std("sales_rate_contract", "sales", "Rate contract", "RC", { defaultResetPolicy: "calendar_year" }),
    org("sales_invoice_request", "sales", "Invoice request", "SIR-"),
    // Accounting
    org("journal_entry", "accounting", "Journal entry", "JE-"),
    { ...org("customer_invoice", "accounting", "Customer invoice", "INV-"), gstDocument: true },
    { ...org("customer_credit_note", "accounting", "Customer credit note", "CRN-"), gstDocument: true },
    org("customer_receipt", "accounting", "Customer receipt", "RCT-"),
    std("customer_refund", "accounting", "Customer refund", "RFND", { defaultResetPolicy: "calendar_year" }),
    org("vendor_bill", "accounting", "Vendor bill", "BILL-"),
    org("vendor_credit_note", "accounting", "Vendor credit note", "VCN-"),
    org("vendor_payment", "accounting", "Vendor payment", "PAY-"),
    org("vendor_credit_refund", "accounting", "Vendor credit refund", "VCR-"),
    org("bank_statement", "accounting", "Bank statement", "STMT-"),
    std("accounting_expense", "accounting", "Expense", "EXP"),
    std("accounting_fund_transfer", "accounting", "Bank / cash transfer", "TRF"),
    std("accounting_opening_balance", "accounting", "Opening balances", "OPB"),
    std("manufacturing_bom", "manufacturing", "Bill of materials", "BOM"),
    std("manufacturing_material_demand", "manufacturing", "Material demand", "MDM"),
    org("fixed_asset", "accounting", "Fixed asset (accounting)", "FA-"),
    org("accounting_close_run", "accounting", "Period close run", "CLS-"),
    org("accounting_revaluation_run", "accounting", "FX revaluation run", "FXR-"),
    org("accounting_compliance_request", "accounting", "Compliance request", "CMP-"),
    org("accounting_cash_forecast", "accounting", "Cash forecast", "CF-"),
    // Procurement
    org("supplier", "procurement", "Supplier", "SUP-", 6),
    org("purchase_requisition", "procurement", "Purchase requisition", "PR-", 6),
    org("sourcing_event", "procurement", "Sourcing event (RFQ)", "RFQ-", 6),
    // Procurement plan Phase 2: the indent a department raises and the RFQ sent to several suppliers.
    std("purchase_indent", "procurement", "Purchase indent", "IND", { defaultResetPolicy: "calendar_year" }),
    std("purchase_rfq", "procurement", "Request for quotation", "RFQ", { defaultResetPolicy: "calendar_year" }),
    // Phase 3: rate contracts, and the self-invoice for a reverse-charge purchase (numbered per financial year, as GST expects).
    std("purchase_rate_contract", "procurement", "Rate contract", "PRC", { defaultResetPolicy: "calendar_year" }),
    std("rcm_self_invoice", "procurement", "Reverse-charge self-invoice", "RCM", { defaultResetPolicy: "fiscal_year" }),
    org("procurement_agreement", "procurement", "Purchase agreement", "AGR-", 6),
    std("supplier_quotation", "procurement", "Supplier quotation", "SQ", { defaultResetPolicy: "calendar_year" }),
    std("purchase_order", "procurement", "Purchase order", "PO", { defaultResetPolicy: "calendar_year" }),
    std("goods_receipt", "procurement", "Goods receipt", "GRN", { defaultResetPolicy: "calendar_year" }),
    std("receiving_rejection", "procurement", "Receiving rejection", "RJR", { defaultResetPolicy: "calendar_year" }),
    org("service_entry", "procurement", "Service entry", "SE-", 6),
    std("purchase_return", "procurement", "Purchase return", "PRN", { defaultResetPolicy: "calendar_year" }),
    std("supplier_debit_claim", "procurement", "Debit note to supplier", "SDN", { defaultResetPolicy: "calendar_year" }),
    std("vendor_credit", "procurement", "Vendor credit", "VC", { defaultResetPolicy: "calendar_year" }),
    // Stock
    std("stock_movement", "stock", "Stock movement", "STK"),
    std("stock_reservation", "stock", "Stock reservation", "RES", { defaultResetPolicy: "calendar_year" }),
    std("stock_transfer", "stock", "Stock transfer", "TRF"),
    std("opening_stock", "stock", "Opening stock", "OS", { defaultResetPolicy: "calendar_year" }),
    std("goods_issue", "stock", "Goods issue", "GI", { defaultResetPolicy: "calendar_year" }),
    std("inventory_transfer", "stock", "Internal transfer", "TR", { defaultResetPolicy: "calendar_year" }),
    std("inventory_adjustment", "stock", "Stock adjustment", "IA", { defaultResetPolicy: "calendar_year" }),
    std("stock_pick_list", "stock", "Pick list", "PCK"),
    std("physical_inventory_count", "stock", "Stock count", "SC", { defaultResetPolicy: "calendar_year" }),
    std("inventory_stock_hold", "stock", "Quality hold", "QH", { defaultResetPolicy: "calendar_year" }),
    // Assets
    std("asset", "assets", "Asset", "AST", { configurable: false }),
    std("asset_category", "assets", "Asset category", "ACAT", { configurable: false }),
    std("asset_location", "assets", "Asset location", "ALOC", { configurable: false }),
    std("asset_assignment", "assets", "Asset assignment", "ASG"),
    std("asset_assignment_batch", "assets", "Bulk asset assignment", "ASB"),
    std("asset_movement_correction", "assets", "Movement correction", "MVC"),
    std("asset_calibration", "assets", "Asset calibration", "CAL"),
    std("asset_depreciation_policy", "assets", "Depreciation policy", "DPP", { configurable: false }),
    std("asset_depreciation_run", "assets", "Depreciation run", "DEP"),
    std("asset_disposal", "assets", "Asset disposal", "DSP"),
    std("asset_disposal_case", "assets", "Asset disposal case", "ADP"),
    std("asset_inspection", "assets", "Asset inspection", "INS"),
    std("asset_maintenance_order", "assets", "Maintenance order", "AMO"),
    std("asset_maintenance_request", "assets", "Maintenance request", "AMR"),
    std("asset_maintenance_work_order", "assets", "Maintenance Work Order", "AMW"),
    std("asset_maintenance_plan", "assets", "Preventive maintenance plan", "AMP"),
    std("asset_transfer", "assets", "Asset transfer", "ATR"),
    std("asset_value_adjustment", "assets", "Asset value adjustment", "ADJ"),
    std("asset_verification", "assets", "Asset verification", "VER"),
    // Projects
    std("project", "projects", "Project", "PRJ"),
    std("project_billing", "projects", "Project billing", "PBL"),
    std("project_issue", "projects", "Project issue", "ISS"),
    std("project_milestone", "projects", "Project milestone", "MS"),
    std("project_task", "projects", "Project task", "TASK"),
    std("project_risk", "projects", "Project risk", "RSK"),
    std("project_task", "projects", "Project task (per project)", "TASK", { family: true, configurable: false }),
    // Manufacturing
    std("manufacturing_work_order", "manufacturing", "Work order (earlier production orders)", "WO"),
    std("manufacturing_order", "manufacturing", "Manufacturing order", "MO"),
    std("manufacturing_material_issue", "manufacturing", "Material issue to production", "MIS"),
    std("manufacturing_material_return", "manufacturing", "Material return from production", "MRT"),
    std("manufacturing_material_issue_note", "manufacturing", "Material issue note", "MI"),
    std("manufacturing_material_issue_reversal", "manufacturing", "Material issue reversal", "MIR"),
    std("manufacturing_material_consumption", "manufacturing", "Material consumption note", "MC"),
    std("manufacturing_material_consumption_correction", "manufacturing", "Material consumption correction", "MCC"),
    std("manufacturing_production_entry", "manufacturing", "Production entry", "MPE"),
    std("manufacturing_production_correction", "manufacturing", "Production correction", "MPC"),
    std("manufacturing_goods_receipt", "manufacturing", "Finished-goods receipt", "FGR"),
    std("manufacturing_scrap", "manufacturing", "Manufacturing scrap", "MS"),
    std("manufacturing_quality_inspection", "manufacturing", "Production quality inspection", "MQI"),
    std("manufacturing_quality_template", "manufacturing", "Inspection checklist", "QCT"),
    std("manufacturing_quality_correction", "manufacturing", "Quality correction", "MQC"),
    std("manufacturing_production_hold", "manufacturing", "Production hold", "MPH"),
    std("manufacturing_variance_exception", "manufacturing", "Material variance exception", "MVX"),
    std("manufacturing_cost_adjustment", "manufacturing", "Production cost adjustment", "MCA"),
    std("manufacturing_cost_rate", "manufacturing", "Labor or overhead rate", "MCR"),
    std("manufacturing_scrap_correction", "manufacturing", "Manufacturing scrap correction", "MSC"),
    std("manufacturing_goods_receipt_correction", "manufacturing", "Finished-goods receipt correction", "FGC"),
    std("manufacturing_mrp_run", "manufacturing", "MRP run", "MRP"),
    std("manufacturing_engineering_change", "manufacturing", "Engineering change", "ECN"),
    // Quality
    std("quality_inspection", "quality", "Inspection", "QI"),
    std("quality_disposition", "quality", "Quality disposition", "QD"),
    std("quality_specification", "quality", "Inspection specification", "QSP", { configurable: false }),
    std("quality_control_point", "quality", "Quality control point", "QCP", { configurable: false }),
    std("quality_hold", "quality", "Quality hold", "QH"),
    std("quality_nonconformance", "quality", "Non-conformance", "NC"),
    std("quality_capa", "quality", "CAPA", "CAPA"),
    std("quality_audit", "quality", "Quality audit", "QA"),
    std("quality_document", "quality", "Controlled document", "QD"),
    std("quality_calibration", "quality", "Calibration", "CAL"),
    std("quality_certificate", "quality", "Certificate of analysis", "COA"),
    std("quality_complaint", "quality", "Customer complaint", "CC"),
    // Support
    std("support_ticket", "support", "Support ticket", "TKT"),
    std("support_knowledge_article", "support", "Knowledge article", "KB"),
    std("support_entitlement", "support", "Entitlement", "ENT"),
    // HR & Payroll
    std("hr_employee", "hr-payroll", "Employee", "EMP", { configurable: false }),
    std("hr_candidate", "hr-payroll", "Candidate", "CAN"),
    std("hr_job_opening", "hr-payroll", "Job opening", "JOB"),
    std("hr_offer", "hr-payroll", "Offer", "OFR"),
    std("hr_expense", "hr-payroll", "Expense claim", "EXP"),
    std("hr_loan", "hr-payroll", "Loan / advance", "LN", { configurable: false }),
    std("hr_payroll_run", "hr-payroll", "Payroll run", "PAY"),
    std("hr_bank_file", "hr-payroll", "Bank file", "BNK"),
    std("hr_final_settlement", "hr-payroll", "Final settlement", "FS"),
    // Point of sale (formats owned by store / terminal settings)
    std("pos_cart", "point-of-sale", "POS bill (cart) reference", "CART", { configurable: false }),
    std("pos_receipt", "point-of-sale", "POS receipt", "RCPT", { configurable: false }),
    std("pos_return", "point-of-sale", "POS return", "RET", { configurable: false }),
    std("pos_refund", "point-of-sale", "POS refund", "RF", { configurable: false }),
    std("pos_cash_movement", "point-of-sale", "Cash movement", "CASH", { configurable: false }),
    std("pos_cash_difference", "point-of-sale", "Cash difference", "CD", { configurable: false }),
    std("payment_reconciliation_exception", "point-of-sale", "Payment reconciliation exception", "PRX", { configurable: false }),
    std("pos_day_end_report", "point-of-sale", "Day-end report", "ZREP", { configurable: false }),
    std("pos_day_end_correction", "point-of-sale", "Day-end correction", "ZCORR", { configurable: false }),
    std("pos_reconciliation", "point-of-sale", "Reconciliation", "RECN", { configurable: false }),
    std("pos_reconciliation_correction", "point-of-sale", "Reconciliation correction", "RCORR", { configurable: false }),
    std("pos_shift", "point-of-sale", "Shift (per terminal)", "SHIFT", { family: true, configurable: false }),
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
