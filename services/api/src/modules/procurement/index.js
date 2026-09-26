import { createHash, randomUUID } from "node:crypto";

import { add, allocate, decimal, format, mul } from "./money.js";
import { hasAnyOwnField, omitFields } from "../../core/access/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";

// Supplier banking/financial-account keys inside tenant.procurement_suppliers'
// jsonb `data` column, gated behind procurement.suppliers.sensitive (see
// docs/implementation/ERP_SECURITY_HARDENING_003.md, Part 1). Deliberately
// does NOT include taxRegistrationNumber: that field is already collected
// by the standard, currently-ungated supplier form and used by roles (e.g.
// Buyer) that hold procurement.suppliers.manage without .sensitive — gating
// it now would break an existing working workflow (Part 8). No supplier
// banking field is wired into any current form, so protecting this set
// closes a real mass-assignment gap without regressing any caller.
const SUPPLIER_SENSITIVE_FIELDS = Object.freeze([
  "bankAccountNumber",
  "bankAccountName",
  "bankName",
  "bankBranch",
  "bankIfscCode",
  "bankSwiftCode",
  "bankRoutingNumber",
  "bankIban",
]);

export class ProcurementError extends Error {
  constructor(status, message, code = "PROCUREMENT_ERROR") {
    super(message);
    this.name = "ProcurementError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INITIAL_DOCUMENT_STATUS = Object.freeze({
  suppliers: "draft",
  categories: "active",
  catalogs: "draft",
  requisitions: "draft",
  "sourcing-events": "draft",
  agreements: "draft",
  "purchase-orders": "draft",
  receipts: "draft",
  "service-entries": "draft",
  returns: "draft",
  "match-exceptions": "open",
});

const INTERNAL_INPUT_FIELDS = new Set([
  "status",
  "approvalStatus",
  "allowLifecycleEdit",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "version",
  "contentHash",
  "lastAction",
  "expectedVersion",
  "action",
]);

const CHILDREN = Object.freeze({
  suppliers: [
    ["sites", "procurement_supplier_sites"],
    ["qualifications", "procurement_supplier_qualifications"],
    ["certifications", "procurement_supplier_certifications"],
    ["scorecards", "procurement_supplier_scorecards"],
  ],
  catalogs: [["items", "procurement_catalog_items"]],
  requisitions: [
    ["lines", "procurement_requisition_lines"],
    ["distributions", "procurement_requisition_distributions"],
  ],
  "sourcing-events": [
    ["invitations", "procurement_sourcing_invitations"],
    ["bids", "procurement_sourcing_bids"],
    ["evaluations", "procurement_sourcing_evaluations"],
  ],
  agreements: [["lines", "procurement_agreement_lines"]],
  "purchase-orders": [
    ["lines", "procurement_purchase_order_lines"],
    ["schedules", "procurement_purchase_order_schedules"],
    ["shippingNotices", "procurement_advance_shipping_notices"],
  ],
  receipts: [["lines", "procurement_receipt_lines"]],
  "service-entries": [["lines", "procurement_service_entry_lines"]],
  returns: [["lines", "procurement_return_lines"]],
  "match-exceptions": [["matchingRecords", "procurement_matching_records"]],
});

const RESOURCE_CONFIG = Object.freeze({
  suppliers: {
    table: "procurement_suppliers",
    kind: "document",
    view: "procurement.suppliers.view",
    create: "procurement.suppliers.manage",
    manage: "procurement.suppliers.manage",
    titleFields: ["supplierCode", "legalName", "name", "displayName"],
  },
  "supplier-sites": {
    table: "procurement_supplier_sites",
    kind: "child",
    view: "procurement.suppliers.view",
    create: "procurement.suppliers.manage",
    manage: "procurement.suppliers.manage",
    parentResource: "suppliers",
  },
  "supplier-qualifications": {
    table: "procurement_supplier_qualifications",
    kind: "child",
    view: "procurement.suppliers.view",
    create: "procurement.suppliers.qualify",
    manage: "procurement.suppliers.qualify",
    parentResource: "suppliers",
  },
  "supplier-certifications": {
    table: "procurement_supplier_certifications",
    kind: "child",
    view: "procurement.suppliers.view",
    create: "procurement.suppliers.qualify",
    manage: "procurement.suppliers.qualify",
    parentResource: "suppliers",
  },
  "supplier-scorecards": {
    table: "procurement_supplier_scorecards",
    kind: "child",
    view: "procurement.suppliers.view",
    create: "procurement.suppliers.qualify",
    manage: "procurement.suppliers.qualify",
    parentResource: "suppliers",
  },
  categories: {
    table: "procurement_categories",
    kind: "document",
    view: "procurement.view",
    create: "procurement.settings.manage",
    manage: "procurement.settings.manage",
    titleFields: ["code", "name", "title"],
  },
  catalogs: {
    table: "procurement_catalogs",
    kind: "document",
    view: "procurement.view",
    create: "procurement.catalog.manage",
    manage: "procurement.catalog.manage",
    titleFields: ["code", "name", "title"],
  },
  "catalog-items": {
    table: "procurement_catalog_items",
    kind: "child",
    view: "procurement.view",
    create: "procurement.catalog.manage",
    manage: "procurement.catalog.manage",
    parentResource: "catalogs",
  },
  requisitions: {
    table: "procurement_requisitions",
    kind: "document",
    view: "procurement.view",
    create: "procurement.requisition.create",
    manage: "procurement.requisition.manage",
    titleFields: ["requisitionNumber", "title", "name"],
  },
  "sourcing-events": {
    table: "procurement_sourcing_events",
    kind: "document",
    view: "procurement.view",
    create: "procurement.sourcing.manage",
    manage: "procurement.sourcing.manage",
    titleFields: ["eventNumber", "title", "name"],
  },
  "sourcing-invitations": {
    table: "procurement_sourcing_invitations",
    kind: "child",
    view: "procurement.view",
    create: "procurement.sourcing.manage",
    manage: "procurement.sourcing.manage",
    parentResource: "sourcing-events",
  },
  "sourcing-bids": {
    table: "procurement_sourcing_bids",
    kind: "child",
    view: "procurement.view",
    create: "procurement.sourcing.manage",
    manage: "procurement.sourcing.manage",
    parentResource: "sourcing-events",
  },
  "sourcing-evaluations": {
    table: "procurement_sourcing_evaluations",
    kind: "child",
    view: "procurement.view",
    create: "procurement.sourcing.evaluate",
    manage: "procurement.sourcing.evaluate",
    parentResource: "sourcing-events",
  },
  agreements: {
    table: "procurement_agreements",
    kind: "document",
    view: "procurement.view",
    create: "procurement.contracts.manage",
    manage: "procurement.contracts.manage",
    titleFields: ["agreementNumber", "title", "name"],
  },
  "purchase-orders": {
    table: "procurement_purchase_orders",
    kind: "document",
    view: "procurement.view",
    create: "procurement.po.create",
    manage: "procurement.po.manage",
    titleFields: ["purchaseOrderNumber", "title", "name"],
  },
  "advance-shipping-notices": {
    table: "procurement_advance_shipping_notices",
    kind: "child",
    view: "procurement.view",
    create: "procurement.receipts.manage",
    manage: "procurement.receipts.manage",
    parentResource: "purchase-orders",
  },
  receipts: {
    table: "procurement_receipts",
    kind: "document",
    view: "procurement.view",
    create: "procurement.receipts.manage",
    manage: "procurement.receipts.manage",
    titleFields: ["receiptNumber", "title", "name"],
  },
  "service-entries": {
    table: "procurement_service_entries",
    kind: "document",
    view: "procurement.view",
    create: "procurement.receipts.manage",
    manage: "procurement.receipts.manage",
    titleFields: ["serviceEntryNumber", "title", "name"],
  },
  returns: {
    table: "procurement_returns",
    kind: "document",
    view: "procurement.view",
    create: "procurement.returns.manage",
    manage: "procurement.returns.manage",
    titleFields: ["returnNumber", "title", "name"],
  },
  "match-exceptions": {
    table: "procurement_match_exceptions",
    kind: "document",
    view: "procurement.view",
    create: "procurement.matching.manage",
    manage: "procurement.matching.manage",
    titleFields: ["exceptionNumber", "invoiceNumber", "title", "name"],
  },
  policies: {
    table: "procurement_policies",
    kind: "child",
    view: "procurement.view",
    create: "procurement.settings.manage",
    manage: "procurement.settings.manage",
  },
  "source-rules": {
    table: "procurement_source_rules",
    kind: "child",
    view: "procurement.view",
    create: "procurement.settings.manage",
    manage: "procurement.settings.manage",
  },
  "portal-users": {
    table: "procurement_portal_users",
    kind: "child",
    view: "procurement.suppliers.view",
    create: "procurement.supplier_portal.manage",
    manage: "procurement.supplier_portal.manage",
    parentResource: "suppliers",
  },
  outbox: {
    table: "procurement_outbox",
    kind: "outbox",
    view: "procurement.audit.view",
    create: null,
    manage: null,
  },
});

const REPORTS = new Set([
  "spend-analysis",
  "supplier-performance",
  "purchase-price-variance",
  "contract-compliance",
  "maverick-spend",
  "open-commitments",
  "overdue-orders",
  "matching-exceptions",
  "savings",
  "cycle-time",
  "supplier-risk",
  "agreement-consumption",
]);

function isOwner(context) {
  return (context.roleSlugs || []).some((value) =>
    ["organization_owner", "system_administrator"].includes(value),
  );
}

function permission(context, key) {
  if (!key || isOwner(context)) return;
  if (!(context.permissions || []).includes(key)) {
    throw new ProcurementError(
      403,
      "You do not have permission to perform this action.",
      "PROCUREMENT_FORBIDDEN",
    );
  }
}

function canViewSupplierSensitiveFields(context) {
  return isOwner(context) || (context.permissions || []).includes("procurement.suppliers.sensitive");
}

function applySupplierFieldVisibility(resource, row, context) {
  if (resource !== "suppliers" || canViewSupplierSensitiveFields(context)) return row;
  return omitFields(row, SUPPLIER_SENSITIVE_FIELDS);
}

function assertSupplierSensitiveFieldsAllowed(resource, input, context) {
  if (resource !== "suppliers" || canViewSupplierSensitiveFields(context)) return;
  if (hasAnyOwnField(input, SUPPLIER_SENSITIVE_FIELDS)) {
    throw new ProcurementError(
      403,
      "You do not have permission to set sensitive supplier banking details.",
      "PROCUREMENT_SUPPLIER_SENSITIVE_FORBIDDEN",
    );
  }
}

function id(value, label = "Record") {
  if (!UUID.test(String(value || ""))) {
    throw new ProcurementError(400, `${label} is invalid.`, "PROCUREMENT_INVALID_ID");
  }
  return String(value);
}

function optionalId(value, label) {
  return value ? id(value, label) : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function object(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProcurementError(400, `${label} must be an object.`, "PROCUREMENT_INVALID_INPUT");
  }
  return { ...value };
}

function externalPayload(value) {
  const payload = object(value);
  for (const key of INTERNAL_INPUT_FIELDS) delete payload[key];
  return payload;
}

function expectedVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version <= 0) {
    throw new ProcurementError(400, "Expected version is required for this Procurement mutation.", "PROCUREMENT_EXPECTED_VERSION_REQUIRED");
  }
  return version;
}

function array(value, label, { required = false } = {}) {
  const result = value == null ? [] : value;
  if (!Array.isArray(result)) {
    throw new ProcurementError(400, `${label} must be a list.`, "PROCUREMENT_INVALID_INPUT");
  }
  if (required && !result.length) {
    throw new ProcurementError(400, `Add at least one ${label.toLowerCase()}.`, "PROCUREMENT_LINES_REQUIRED");
  }
  return result.map((entry, index) => object(entry, `${label} ${index + 1}`));
}

function text(value, label, { required = false, max = 5000 } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) {
    throw new ProcurementError(400, `${label} is required.`, "PROCUREMENT_REQUIRED_FIELD");
  }
  if (result.length > max) {
    throw new ProcurementError(400, `${label} is too long.`, "PROCUREMENT_INVALID_INPUT");
  }
  return result;
}

function positiveDecimal(value, label, { allowZero = false } = {}) {
  let scaled;
  try {
    scaled = decimal(value);
  } catch {
    throw new ProcurementError(400, `${label} must be a valid amount.`, "PROCUREMENT_INVALID_AMOUNT");
  }
  if (scaled < 0n || (!allowZero && scaled === 0n)) {
    throw new ProcurementError(400, `${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`, "PROCUREMENT_INVALID_AMOUNT");
  }
  return format(scaled, 6);
}

function configFor(resource) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) {
    throw new ProcurementError(404, "Unknown Procurement resource.", "PROCUREMENT_RESOURCE_NOT_FOUND");
  }
  return config;
}

function ensureCompanyAccess(context, companyId) {
  if (!companyId) return;
  if (!context.allowAllCompanies && context.activeCompanyId && companyId !== context.activeCompanyId) {
    throw new ProcurementError(403, "The selected company is outside your active company context.", "PROCUREMENT_COMPANY_SCOPE");
  }
}

function normalizeLine(line, index, resource) {
  const normalized = { ...line };
  if (line.id) normalized.id = id(line.id, `${resource} line`);
  if (line.itemId) normalized.itemId = id(line.itemId, "Item");
  if (line.uomId) normalized.uomId = id(line.uomId, "Unit of measure");
  if (line.warehouseId) normalized.warehouseId = id(line.warehouseId, "Warehouse");
  if (line.purchaseOrderLineId) normalized.purchaseOrderLineId = id(line.purchaseOrderLineId, "Purchase order line");
  if (line.requisitionLineId) normalized.requisitionLineId = id(line.requisitionLineId, "Requisition line");
  if ("quantity" in line) normalized.quantity = positiveDecimal(line.quantity, `Line ${index + 1} quantity`);
  if ("receivedQuantity" in line) normalized.receivedQuantity = positiveDecimal(line.receivedQuantity, `Line ${index + 1} received quantity`, { allowZero: true });
  if ("acceptedQuantity" in line) normalized.acceptedQuantity = positiveDecimal(line.acceptedQuantity, `Line ${index + 1} accepted quantity`, { allowZero: true });
  if ("rejectedQuantity" in line) normalized.rejectedQuantity = positiveDecimal(line.rejectedQuantity, `Line ${index + 1} rejected quantity`, { allowZero: true });
  if ("unitPrice" in line) normalized.unitPrice = positiveDecimal(line.unitPrice, `Line ${index + 1} unit price`, { allowZero: true });
  if ("taxAmount" in line) normalized.taxAmount = positiveDecimal(line.taxAmount, `Line ${index + 1} tax`, { allowZero: true });
  normalized.description = text(line.description || line.name || line.itemName, `Line ${index + 1} description`, { required: true, max: 1000 });
  return normalized;
}

function lineAmount(line) {
  const quantity = line.quantity ?? line.acceptedQuantity ?? line.receivedQuantity ?? "0";
  const unitPrice = line.unitPrice ?? "0";
  return mul(quantity, unitPrice) + decimal(line.taxAmount ?? "0");
}

function calculateTotals(lines) {
  const subtotal = lines.reduce(
    (sum, line) => sum + mul(line.quantity ?? "0", line.unitPrice ?? "0"),
    0n,
  );
  const taxTotal = lines.reduce((sum, line) => sum + decimal(line.taxAmount ?? "0"), 0n);
  return {
    subtotal: format(subtotal, 2),
    taxTotal: format(taxTotal, 2),
    grandTotal: format(subtotal + taxTotal, 2),
  };
}

function normalizeDocument(resource, input, context) {
  const value = externalPayload(input);
  const companyId = value.companyId || context.activeCompanyId;
  if (!companyId) {
    throw new ProcurementError(409, "Select an active company.", "PROCUREMENT_COMPANY_REQUIRED");
  }
  value.companyId = id(companyId, "Company");
  value.branchId = optionalId(value.branchId || context.activeBranchId, "Branch");
  ensureCompanyAccess(context, value.companyId);

  const common = {
    ...value,
    currencyCode: text(value.currencyCode || "INR", "Currency", { required: true, max: 3 }).toUpperCase(),
  };

  switch (resource) {
    case "suppliers": {
      common.legalName = text(value.legalName || value.name || value.displayName, "Supplier legal name", { required: true, max: 240 });
      common.displayName = text(value.displayName || common.legalName, "Supplier display name", { required: true, max: 240 });
      common.supplierCode = text(value.supplierCode || value.code, "Supplier code", { required: true, max: 60 }).toUpperCase();
      // Optional link to the Accounting business partner this supplier
      // corresponds to. Procurement and Accounting/Sales/CRM do not share
      // one supplier/customer entity (unlike Sales, which consumes CRM's
      // tenant.business_parties directly) -- this is the minimum additive
      // field needed so a matched invoice can actually be imported as a
      // real vendor bill (accounting.payables.importProcurementMatchAsVendorBill
      // already requires a partyId; nothing populated one before this).
      common.accountingPartyId = value.accountingPartyId ? id(value.accountingPartyId, "Accounting business partner") : null;
      common.sites = array(value.sites, "Supplier sites");
      common.qualifications = array(value.qualifications, "Supplier qualifications");
      common.certifications = array(value.certifications, "Supplier certifications");
      common.scorecards = array(value.scorecards, "Supplier scorecards");
      return common;
    }
    case "categories":
      common.name = text(value.name || value.title, "Category name", { required: true, max: 160 });
      common.code = text(value.code, "Category code", { required: true, max: 60 }).toUpperCase();
      return common;
    case "catalogs":
      common.name = text(value.name || value.title, "Catalog name", { required: true, max: 160 });
      common.code = text(value.code, "Catalog code", { required: true, max: 60 }).toUpperCase();
      common.items = array(value.items, "Catalog items").map((line, index) => normalizeLine(line, index, resource));
      return common;
    case "requisitions": {
      common.title = text(value.title || value.name, "Requisition title", { required: true, max: 240 });
      common.requestedBy = value.requestedBy ? id(value.requestedBy, "Requester") : context.userId;
      common.needByDate = text(value.needByDate, "Need-by date", { required: true, max: 10 });
      common.lines = array(value.lines, "Requisition lines", { required: true }).map((line, index) => normalizeLine(line, index, resource));
      common.distributions = array(value.distributions, "Requisition distributions");
      common.totals = calculateTotals(common.lines);
      return common;
    }
    case "sourcing-events":
      common.title = text(value.title || value.name, "Sourcing event title", { required: true, max: 240 });
      common.eventType = text(value.eventType || "rfq", "Event type", { required: true, max: 20 }).toLowerCase();
      common.bidCloseAt = text(value.bidCloseAt, "Bid close date", { required: true, max: 40 });
      common.invitations = array(value.invitations, "Sourcing invitations");
      common.bids = array(value.bids, "Sourcing bids");
      common.evaluations = array(value.evaluations, "Sourcing evaluations");
      return common;
    case "agreements":
      common.title = text(value.title || value.name, "Agreement title", { required: true, max: 240 });
      common.supplierId = id(value.supplierId, "Supplier");
      common.validFrom = text(value.validFrom, "Valid-from date", { required: true, max: 10 });
      common.validUntil = text(value.validUntil, "Valid-until date", { required: true, max: 10 });
      common.lines = array(value.lines, "Agreement lines", { required: true }).map((line, index) => normalizeLine(line, index, resource));
      common.totals = calculateTotals(common.lines);
      return common;
    case "purchase-orders":
      common.title = text(value.title || value.name || "Purchase order", "Purchase order title", { required: true, max: 240 });
      common.supplierId = id(value.supplierId, "Supplier");
      common.expectedDeliveryDate = text(value.expectedDeliveryDate, "Expected delivery date", { required: true, max: 10 });
      common.lines = array(value.lines, "Purchase order lines", { required: true }).map((line, index) => ({
        ...normalizeLine(line, index, resource),
        receivedQuantity: positiveDecimal(line.receivedQuantity ?? "0", `Line ${index + 1} received quantity`, { allowZero: true }),
        invoicedQuantity: positiveDecimal(line.invoicedQuantity ?? "0", `Line ${index + 1} invoiced quantity`, { allowZero: true }),
      }));
      common.schedules = array(value.schedules, "Purchase order schedules");
      common.shippingNotices = array(value.shippingNotices, "Advance shipping notices");
      common.totals = calculateTotals(common.lines);
      return common;
    case "receipts":
      common.purchaseOrderId = id(value.purchaseOrderId, "Purchase order");
      common.receiptDate = text(value.receiptDate, "Receipt date", { required: true, max: 10 });
      common.lines = array(value.lines, "Receipt lines", { required: true }).map((line, index) => ({
        ...normalizeLine(line, index, resource),
        acceptedQuantity: positiveDecimal(line.acceptedQuantity ?? line.quantity, `Line ${index + 1} accepted quantity`, { allowZero: true }),
        rejectedQuantity: positiveDecimal(line.rejectedQuantity ?? "0", `Line ${index + 1} rejected quantity`, { allowZero: true }),
      }));
      return common;
    case "service-entries":
      common.purchaseOrderId = id(value.purchaseOrderId, "Purchase order");
      common.serviceDate = text(value.serviceDate, "Service date", { required: true, max: 10 });
      common.lines = array(value.lines, "Service entry lines", { required: true }).map((line, index) => normalizeLine(line, index, resource));
      return common;
    case "returns":
      common.receiptId = id(value.receiptId, "Receipt");
      common.reason = text(value.reason, "Return reason", { required: true, max: 1000 });
      common.lines = array(value.lines, "Return lines", { required: true }).map((line, index) => normalizeLine(line, index, resource));
      return common;
    case "match-exceptions":
      common.title = text(value.title || value.invoiceNumber || "Matching exception", "Exception title", { required: true, max: 240 });
      common.purchaseOrderId = id(value.purchaseOrderId, "Purchase order");
      common.invoiceNumber = text(value.invoiceNumber, "Invoice number", { required: true, max: 100 });
      common.varianceAmount = positiveDecimal(value.varianceAmount ?? "0", "Variance amount", { allowZero: true });
      common.matchingRecords = array(value.matchingRecords, "Matching records");
      return common;
    default:
      return common;
  }
}

function normalizeChild(resource, input, context) {
  const value = externalPayload(input);
  const config = configFor(resource);
  const companyId = value.companyId || context.activeCompanyId || null;
  if (companyId) ensureCompanyAccess(context, id(companyId, "Company"));
  if (config.parentResource && !value.parentId) {
    throw new ProcurementError(400, "Parent record is required.", "PROCUREMENT_PARENT_REQUIRED");
  }
  return {
    ...value,
    companyId: companyId ? id(companyId, "Company") : null,
    parentId: value.parentId ? id(value.parentId, "Parent record") : null,
    status: "active",
  };
}


const DOCUMENT_REFERENCE_COLUMNS = Object.freeze({
  agreements: {
    supplierId: ["supplier_id", "procurement_suppliers"],
    sourceEventId: ["source_event_id", "procurement_sourcing_events"],
    selectedBidId: ["selected_bid_id", "procurement_sourcing_bids"],
  },
  "purchase-orders": {
    supplierId: ["supplier_id", "procurement_suppliers"],
    agreementId: ["agreement_id", "procurement_agreements"],
    requisitionId: ["requisition_id", "procurement_requisitions"],
    sourceEventId: ["source_event_id", "procurement_sourcing_events"],
    selectedBidId: ["selected_bid_id", "procurement_sourcing_bids"],
  },
  receipts: {
    purchaseOrderId: ["purchase_order_id", "procurement_purchase_orders"],
    supplierId: ["supplier_id", "procurement_suppliers"],
  },
  "service-entries": {
    purchaseOrderId: ["purchase_order_id", "procurement_purchase_orders"],
    supplierId: ["supplier_id", "procurement_suppliers"],
  },
  returns: {
    receiptId: ["receipt_id", "procurement_receipts"],
    purchaseOrderId: ["purchase_order_id", "procurement_purchase_orders"],
    supplierId: ["supplier_id", "procurement_suppliers"],
  },
  "match-exceptions": {
    purchaseOrderId: ["purchase_order_id", "procurement_purchase_orders"],
    supplierId: ["supplier_id", "procurement_suppliers"],
  },
});

const CHILD_PARENT_EDITABLE_STATES = Object.freeze({
  "supplier-sites": ["draft", "submitted", "qualified", "active", "suspended"],
  "supplier-qualifications": ["draft", "submitted", "qualified", "active", "suspended"],
  "supplier-certifications": ["draft", "submitted", "qualified", "active", "suspended"],
  "supplier-scorecards": ["qualified", "active", "suspended", "blocked"],
  "catalog-items": ["draft"],
  "requisition-lines": ["draft", "rejected"],
  "requisition-distributions": ["draft", "rejected"],
  "sourcing-invitations": ["draft", "submitted", "approved", "active"],
  "sourcing-bids": ["active"],
  "sourcing-evaluations": ["active", "closed"],
  "agreement-lines": ["draft", "rejected"],
  "purchase-order-lines": ["draft", "rejected"],
  "purchase-order-schedules": ["draft", "rejected", "approved", "dispatched", "acknowledged", "partially_received"],
  "advance-shipping-notices": ["dispatched", "acknowledged", "partially_received"],
  "receipt-lines": ["draft", "rejected"],
  "service-entry-lines": ["draft", "rejected"],
  "return-lines": ["draft", "rejected"],
  "matching-records": ["open", "resolved", "overridden"],
});

async function loadReference(client, context, table, referenceId, companyId, label, options = {}) {
  const result = await client.query(
    `SELECT id,company_id,status,data FROM tenant.${table}
      WHERE organization_id=$1 AND id=$2 AND company_id=$3`,
    [context.organizationId, id(referenceId, label), companyId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ProcurementError(
      409,
      `${label} does not exist in the selected company.`,
      "PROCUREMENT_REFERENCE_INVALID",
    );
  }
  if (options.allowedStatuses && !options.allowedStatuses.includes(row.status)) {
    throw new ProcurementError(
      409,
      `${label} is not in an eligible lifecycle state.`,
      "PROCUREMENT_REFERENCE_STATE",
    );
  }
  return { ...(row.data || {}), ...row };
}

// F077/F078: an order raised under an agreement (a "call-off") must stay inside what
// was committed. Only an ACTIVE agreement can be called off; each item's cumulative
// ordered quantity (all non-cancelled, non-rejected orders under the agreement, plus
// this one) may not exceed the agreement's committed quantity for that item.
async function assertAgreementCapacity(client, context, resource, payload, excludeOrderId = null) {
  if (resource !== "purchase-orders" || !payload.agreementId) return;
  const agreementId = id(payload.agreementId, "Agreement");
  const agreement = (
    await client.query(`SELECT id,status,data FROM tenant.procurement_agreements WHERE organization_id=$1 AND id=$2`, [context.organizationId, agreementId])
  ).rows[0];
  if (!agreement) throw new ProcurementError(409, "Agreement does not exist.", "PROCUREMENT_REFERENCE_INVALID");
  if (agreement.status !== "active") {
    throw new ProcurementError(409, "Only an active agreement can be called off.", "PROCUREMENT_AGREEMENT_NOT_ACTIVE");
  }
  const key = (line) => String(line.itemId || String(line.description || "").trim().toLowerCase());
  const committed = new Map();
  const agreementLines = await client.query(`SELECT data FROM tenant.procurement_agreement_lines WHERE organization_id=$1 AND parent_id=$2`, [context.organizationId, agreementId]);
  for (const row of agreementLines.rows) committed.set(key(row.data || {}), (committed.get(key(row.data || {})) || 0n) + decimal(row.data?.quantity ?? "0"));
  const used = new Map();
  const existing = await client.query(
    `SELECT line.data FROM tenant.procurement_purchase_order_lines line
       JOIN tenant.procurement_purchase_orders po ON po.organization_id=line.organization_id AND po.id=line.parent_id
      WHERE po.organization_id=$1 AND po.agreement_id=$2 AND po.status NOT IN ('cancelled','rejected')
        AND ($3::uuid IS NULL OR po.id<>$3)`,
    [context.organizationId, agreementId, excludeOrderId],
  );
  for (const row of existing.rows) used.set(key(row.data || {}), (used.get(key(row.data || {})) || 0n) + decimal(row.data?.quantity ?? "0"));
  for (const line of Array.isArray(payload.lines) ? payload.lines : []) {
    const lineKey = key(line);
    if (!committed.has(lineKey)) {
      throw new ProcurementError(409, `"${line.description}" is not on this agreement.`, "PROCUREMENT_AGREEMENT_ITEM_NOT_COVERED");
    }
    used.set(lineKey, (used.get(lineKey) || 0n) + decimal(line.quantity ?? "0"));
    if (used.get(lineKey) > committed.get(lineKey)) {
      throw new ProcurementError(
        409,
        `"${line.description}" would exceed the agreement: ${format(used.get(lineKey), 4)} ordered against ${format(committed.get(lineKey), 4)} committed.`,
        "PROCUREMENT_AGREEMENT_EXCEEDED",
      );
    }
  }
}

async function validateDocumentReferences(client, context, resource, payload) {
  const references = {};
  const companyId = id(payload.companyId, "Company");
  const configured = DOCUMENT_REFERENCE_COLUMNS[resource] || {};
  for (const [payloadKey, [column, table]] of Object.entries(configured)) {
    if (!payload[payloadKey]) continue;
    const row = await loadReference(
      client,
      context,
      table,
      payload[payloadKey],
      companyId,
      payloadKey,
      {
        allowedStatuses:
          payloadKey === "supplierId"
            ? ["qualified", "active"]
            : payloadKey === "purchaseOrderId"
              ? ["approved", "dispatched", "acknowledged", "partially_received", "received"]
              : undefined,
      },
    );
    references[column] = row.id;
  }

  if (resource === "receipts" || resource === "service-entries") {
    const order = await loadReference(
      client,
      context,
      "procurement_purchase_orders",
      payload.purchaseOrderId,
      companyId,
      "Purchase order",
      {
        allowedStatuses: ["approved", "dispatched", "acknowledged", "partially_received", "received"],
      },
    );
    references.purchase_order_id = order.id;
    references.supplier_id = order.supplier_id || order.supplierId || null;
    payload.supplierId = references.supplier_id;
  }
  if (resource === "returns") {
    const receipt = await loadReference(
      client,
      context,
      "procurement_receipts",
      payload.receiptId,
      companyId,
      "Receipt",
      { allowedStatuses: ["approved", "received", "reversed"] },
    );
    references.receipt_id = receipt.id;
    references.purchase_order_id = receipt.purchase_order_id || receipt.purchaseOrderId || null;
    references.supplier_id = receipt.supplier_id || receipt.supplierId || null;
    payload.purchaseOrderId = references.purchase_order_id;
    payload.supplierId = references.supplier_id;
  }
  if (resource === "match-exceptions" && payload.purchaseOrderId) {
    const order = await loadReference(
      client,
      context,
      "procurement_purchase_orders",
      payload.purchaseOrderId,
      companyId,
      "Purchase order",
    );
    references.purchase_order_id = order.id;
    references.supplier_id = order.supplier_id || order.supplierId || null;
    payload.supplierId = references.supplier_id;
  }
  return references;
}

async function persistDocumentReferences(client, resource, recordId, references, payload) {
  const configured = DOCUMENT_REFERENCE_COLUMNS[resource] || {};
  const assignments = [];
  const values = [recordId];
  const seen = new Set();
  for (const [column, value] of Object.entries(references)) {
    if (seen.has(column)) continue;
    seen.add(column);
    values.push(value || null);
    assignments.push(`${column}=$${values.length}`);
  }
  if (resource === "match-exceptions") {
    values.push(payload.invoiceNumber || null);
    assignments.push(`invoice_number=$${values.length}`);
  }
  if (!assignments.length) return;
  await client.query(
    `UPDATE tenant.${configFor(resource).table}
        SET ${assignments.join(",")}
      WHERE id=$1`,
    values,
  );
}

async function validateChildParent(client, context, resource, payload, options = {}) {
  const config = configFor(resource);
  if (!config.parentResource) return null;
  const parentConfig = configFor(config.parentResource);
  const parentId = id(payload.parentId, "Parent record");
  const result = await client.query(
    `SELECT id,company_id,status FROM tenant.${parentConfig.table}
      WHERE organization_id=$1 AND id=$2
      ${options.lock ? "FOR UPDATE" : ""}`,
    [context.organizationId, parentId],
  );
  const parent = result.rows[0];
  if (!parent) {
    throw new ProcurementError(404, "The parent Procurement record was not found.");
  }
  if (payload.companyId && parent.company_id && payload.companyId !== parent.company_id) {
    throw new ProcurementError(409, "The child and parent must belong to the same company.");
  }
  const allowed = CHILD_PARENT_EDITABLE_STATES[resource];
  if (allowed && !allowed.includes(parent.status)) {
    throw new ProcurementError(
      409,
      `A ${resource} record cannot be changed while its parent is ${parent.status}.`,
      "PROCUREMENT_PARENT_LIFECYCLE_LOCK",
    );
  }
  payload.companyId = parent.company_id;
  return parent;
}

function searchText(config, payload, resource) {
  const candidates = [
    ...(config.titleFields || []).map((field) => payload[field]),
    payload.invoiceNumber,
    payload.supplierCode,
    payload.code,
    payload.name,
    payload.title,
    resource,
  ];
  return candidates.filter(Boolean).join(" ").slice(0, 2000);
}

function companyWhere(context, values, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  let clause = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    clause = ` AND (${prefix}company_id=$${values.length} OR ${prefix}company_id IS NULL)`;
  }
  return clause;
}

// Organisation-wide procurement document numbers from the one platform
// numbering service (migration 181 merged the legacy series and the old
// per-company "procurement:<type>" fallback counters).
async function nextNumber(client, context, entityType) {
  return nextDocumentNumber(client, context, { documentType: entityType });
}

const NUMBERING = Object.freeze({
  requisitions: ["purchase_requisition", "PR-", "requisitionNumber"],
  "sourcing-events": ["sourcing_event", "RFQ-", "eventNumber"],
  agreements: ["procurement_agreement", "AGR-", "agreementNumber"],
  "purchase-orders": ["purchase_order", "PO-", "purchaseOrderNumber"],
  receipts: ["goods_receipt", "GRN-", "receiptNumber"],
  "service-entries": ["service_entry", "SE-", "serviceEntryNumber"],
  returns: ["return_to_vendor", "RTV-", "returnNumber"],
  "match-exceptions": ["procurement_match_exception", "MATCH-", "exceptionNumber"],
});

async function ensureNumber(client, context, resource, payload) {
  const rule = NUMBERING[resource];
  if (!rule || payload[rule[2]]) return payload;
  return { ...payload, [rule[2]]: await nextNumber(client, context, rule[0]) };
}


function childReferenceValues(table, child) {
  if (table === "procurement_purchase_order_lines") {
    return {
      item_id: child.itemId || null,
      uom_id: child.uomId || null,
      warehouse_id: child.warehouseId || null,
      requisition_line_id: child.requisitionLineId || null,
      received_quantity: child.receivedQuantity || "0",
      invoiced_quantity: child.invoicedQuantity || "0",
    };
  }
  if (table === "procurement_receipt_lines") {
    return {
      purchase_order_line_id: child.purchaseOrderLineId || null,
      item_id: child.itemId || null,
      uom_id: child.uomId || null,
      warehouse_id: child.warehouseId || null,
      accepted_quantity: child.acceptedQuantity || child.quantity || "0",
      rejected_quantity: child.rejectedQuantity || "0",
    };
  }
  if (table === "procurement_service_entry_lines") {
    return {
      purchase_order_line_id: child.purchaseOrderLineId || null,
      item_id: child.itemId || null,
      uom_id: child.uomId || null,
    };
  }
  if (table === "procurement_return_lines") {
    return {
      receipt_line_id: child.receiptLineId || null,
      purchase_order_line_id: child.purchaseOrderLineId || null,
      item_id: child.itemId || null,
      uom_id: child.uomId || null,
    };
  }
  return {};
}

async function insertChildRow(client, context, table, record, child, status = "active") {
  const normalized = childReferenceValues(table, child);
  const columns = Object.keys(normalized);
  const values = [
    context.organizationId,
    record.company_id,
    record.id,
    status,
    JSON.stringify(child),
    contentHash(child),
    context.userId,
    child.idempotencyKey || null,
    ...Object.values(normalized),
  ];
  const columnSql = columns.length ? `,${columns.join(",")}` : "";
  const placeholderSql = columns.length
    ? `,${columns.map((_, index) => `$${9 + index}`).join(",")}`
    : "";
  const result = await client.query(
    `INSERT INTO tenant.${table}(
      organization_id,company_id,parent_id,status,data,content_hash,updated_by,idempotency_key${columnSql},
      created_at,updated_at
    ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8${placeholderSql},now(),now())
    ON CONFLICT DO NOTHING
    RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

async function persistChildReferences(client, table, recordId, payload) {
  const normalized = childReferenceValues(table, payload);
  const entries = Object.entries(normalized);
  if (!entries.length) return;
  const values = [recordId, ...entries.map(([, value]) => value || null)];
  await client.query(
    `UPDATE tenant.${table}
        SET ${entries.map(([column], index) => `${column}=$${index + 2}`).join(",")}
      WHERE id=$1`,
    values,
  );
}

async function insertChildren(client, context, resource, record, payload) {
  for (const [inputKey, table] of CHILDREN[resource] || []) {
    const entries = Array.isArray(payload[inputKey]) ? payload[inputKey] : [];
    for (const entry of entries) {
      const child = object(entry, inputKey);
      await insertChildRow(
        client,
        context,
        table,
        record,
        child,
        "active",
      );
    }
  }
}

async function replaceChildren(client, context, resource, record, payload) {
  for (const [inputKey, table] of CHILDREN[resource] || []) {
    if (!(inputKey in payload)) continue;
    await client.query(
      `DELETE FROM tenant.${table} WHERE organization_id=$1 AND parent_id=$2`,
      [context.organizationId, record.id],
    );
    await insertChildren(client, context, resource, record, { [inputKey]: payload[inputKey] });
  }
}

async function hydrateChildren(client, context, resource, record) {
  const hydrated = { ...record };
  for (const [inputKey, table] of CHILDREN[resource] || []) {
    const result = await client.query(
      `
        SELECT id,status,version,data,created_at,updated_at
        FROM tenant.${table}
        WHERE organization_id=$1 AND parent_id=$2
        ORDER BY created_at,id
      `,
      [context.organizationId, record.id],
    );
    hydrated[inputKey] = result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      version: row.version,
      ...(row.data || {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  return hydrated;
}

async function event(client, context, record, resource, eventType, payload = {}) {
  await client.query(
    `
      INSERT INTO tenant.procurement_events(
        organization_id,company_id,entity_type,entity_id,event_type,payload,actor_user_id
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
    `,
    [
      context.organizationId,
      record.company_id || null,
      resource,
      record.id,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

async function outbox(client, context, record, topic, payload = {}) {
  const idempotencyKey = `${topic}:${record.id}:${record.version || 1}:${contentHash(payload)}`;
  await client.query(
    `
      INSERT INTO tenant.procurement_outbox(
        organization_id,company_id,topic,payload,idempotency_key,status
      ) VALUES($1,$2,$3,$4::jsonb,$5,'pending')
      ON CONFLICT DO NOTHING
    `,
    [context.organizationId, record.company_id || null, topic, JSON.stringify(payload), idempotencyKey],
  );
}

export function contentHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function procurementContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId || null,
    activeBranchId: session.activeBranchId || null,
    allowAllCompanies: (session.roleSlugs || []).some((value) =>
      ["organization_owner", "system_administrator"].includes(value),
    ),
    permissions: session.permissions || [],
    roleSlugs: session.roleSlugs || [],
  };
}

export async function listProcurementRecords(client, context, resource, filters = {}) {
  const config = configFor(resource);
  permission(context, config.view || "procurement.view");
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const values = [context.organizationId];
  let where = "organization_id=$1";
  where += companyWhere(context, values);
  if (filters.parentId) {
    if (config.kind !== "child") {
      throw new ProcurementError(400, "Parent filtering is not supported for this resource.");
    }
    values.push(id(filters.parentId, "Parent record"));
    where += ` AND parent_id=$${values.length}`;
  }
  if (filters.status) {
    values.push(String(filters.status));
    where += ` AND status=$${values.length}`;
  }
  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    where += config.kind === "document"
      ? ` AND search_text ILIKE $${values.length}`
      : ` AND data::text ILIKE $${values.length}`;
  }
  const count = await client.query(
    `SELECT count(*)::int AS total FROM tenant.${config.table} WHERE ${where}`,
    values,
  );
  const rows = await client.query(
    `SELECT * FROM tenant.${config.table} WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    rows: rows.rows.map((row) =>
      applySupplierFieldVisibility(resource, { ...(row.data || {}), ...row }, context),
    ),
    total: Number(count.rows[0]?.total || 0),
    limit,
    offset,
  };
}

export async function getProcurementRecord(client, context, resource, recordId) {
  const config = configFor(resource);
  permission(context, config.view || "procurement.view");
  const values = [context.organizationId, id(recordId)];
  let where = "organization_id=$1 AND id=$2";
  where += companyWhere(context, values);
  const result = await client.query(
    `SELECT * FROM tenant.${config.table} WHERE ${where}`,
    values,
  );
  if (!result.rows[0]) {
    throw new ProcurementError(404, "Procurement record not found.", "PROCUREMENT_RECORD_NOT_FOUND");
  }
  const row = applySupplierFieldVisibility(
    resource,
    { ...(result.rows[0].data || {}), ...result.rows[0] },
    context,
  );
  return config.kind === "document"
    ? hydrateChildren(client, context, resource, row)
    : row;
}

export async function createProcurementRecord(client, context, resource, input) {
  const config = configFor(resource);
  if (!config.create) {
    throw new ProcurementError(405, "This Procurement resource is read-only.");
  }
  permission(context, config.create);
  assertSupplierSensitiveFieldsAllowed(resource, input, context);

  if (config.kind === "child") {
    const payload = normalizeChild(resource, input, context);
    const parent = await validateChildParent(client, context, resource, payload, { lock: true });
    const childIdempotencyKey = text(input.idempotencyKey, "Idempotency key", { max: 200 });
    payload.idempotencyKey = childIdempotencyKey || null;
    let row = await insertChildRow(
      client,
      context,
      config.table,
      { id: payload.parentId, company_id: parent?.company_id || payload.companyId },
      payload,
      "active",
    );
    if (!row && childIdempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM tenant.${config.table}
          WHERE organization_id=$1 AND parent_id=$2 AND idempotency_key=$3`,
        [context.organizationId, payload.parentId, childIdempotencyKey],
      );
      row = existing.rows[0];
      if (row) return { ...(row.data || {}), ...row };
    }
    if (!row) throw new ProcurementError(409, "The child record could not be created.");
    const record = { ...(row.data || {}), ...row };
    await event(client, context, record, resource, "created", { contentHash: record.content_hash });
    await outbox(client, context, record, `procurement.${resource}.created`, { recordId: record.id });
    return record;
  }

  let payload = normalizeDocument(resource, input, context);
  payload = await ensureNumber(client, context, resource, payload);
  const references = await validateDocumentReferences(client, context, resource, payload);
  await assertAgreementCapacity(client, context, resource, payload);
  const status = INITIAL_DOCUMENT_STATUS[resource] || "draft";
  const idempotencyKey = text(input.idempotencyKey, "Idempotency key", { max: 200 });
  const result = await client.query(
    `
      INSERT INTO tenant.${config.table}(
        organization_id,company_id,branch_id,status,search_text,data,content_hash,
        created_by,updated_by,idempotency_key
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8,$9)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [
      context.organizationId,
      payload.companyId,
      payload.branchId,
      status,
      searchText(config, payload, resource),
      JSON.stringify(payload),
      contentHash(payload),
      context.userId,
      idempotencyKey || null,
    ],
  );
  let record = result.rows[0];
  if (!record && idempotencyKey) {
    const existing = await client.query(
      `SELECT * FROM tenant.${config.table}
        WHERE organization_id=$1 AND idempotency_key=$2`,
      [context.organizationId, idempotencyKey],
    );
    record = existing.rows[0];
    if (record) return hydrateChildren(client, context, resource, { ...(record.data || {}), ...record });
  }
  if (!record) throw new ProcurementError(409, "The Procurement record could not be created.");
  await persistDocumentReferences(client, resource, record.id, references, payload);
  await insertChildren(client, context, resource, record, payload);
  await event(client, context, record, resource, "created", {
    contentHash: record.content_hash,
    status,
  });
  await outbox(client, context, record, `procurement.${resource}.created`, {
    recordId: record.id,
    status,
  });
  return getProcurementRecord(client, context, resource, record.id);
}

export async function updateProcurementRecord(client, context, resource, recordId, input) {
  const config = configFor(resource);
  if (!config.manage) throw new ProcurementError(405, "This Procurement resource is read-only.");
  permission(context, config.manage);
  assertSupplierSensitiveFieldsAllowed(resource, input, context);
  const current = await getProcurementRecord(client, context, resource, recordId);
  if (config.kind === "child") {
    const version = expectedVersion(input.expectedVersion);
    if (version !== Number(current.version || 1)) {
      throw new ProcurementError(409, "This child record changed after it was loaded.", "PROCUREMENT_VERSION_CONFLICT");
    }
    const payload = normalizeChild(resource, { ...(current.data || {}), ...input }, context);
    await validateChildParent(client, context, resource, payload, { lock: true });
    const result = await client.query(
      `
        UPDATE tenant.${config.table}
        SET status=$3,data=$4::jsonb,content_hash=$5,version=version+1,
            updated_by=$6,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$7
        RETURNING *
      `,
      [
        context.organizationId,
        id(recordId),
        payload.status,
        JSON.stringify(payload),
        contentHash(payload),
        context.userId,
        version,
      ],
    );
    if (!result.rows[0]) {
      throw new ProcurementError(409, "This child record changed before the update was applied.", "PROCUREMENT_VERSION_CONFLICT");
    }
    await persistChildReferences(client, config.table, result.rows[0].id, payload);
    const record = {
      ...(result.rows[0].data || {}),
      ...result.rows[0],
      ...childReferenceValues(config.table, payload),
    };
    await event(client, context, record, resource, "updated", { version: record.version });
    await outbox(client, context, record, `procurement.${resource}.updated`, { recordId: record.id, version: record.version });
    return record;
  }
  if (!["draft", "rejected"].includes(current.status)) {
    throw new ProcurementError(409, "Only draft or rejected documents can be edited. Use a governed amendment or lifecycle action for approved records.", "PROCUREMENT_EDIT_LOCKED");
  }
  const version = expectedVersion(input.expectedVersion);
  if (version !== Number(current.version)) {
    throw new ProcurementError(409, "This document changed after it was loaded. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  }
  let payload = normalizeDocument(resource, { ...(current.data || {}), ...input, companyId: current.company_id, branchId: current.branch_id }, context);
  payload = await ensureNumber(client, context, resource, payload);
  const references = await validateDocumentReferences(client, context, resource, payload);
  await assertAgreementCapacity(client, context, resource, payload, id(recordId));
  const result = await client.query(
    `
      UPDATE tenant.${config.table}
      SET company_id=$3,branch_id=$4,search_text=$5,data=$6::jsonb,content_hash=$7,
          version=version+1,updated_by=$8,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND version=$9 AND status IN ('draft','rejected')
      RETURNING *
    `,
    [
      context.organizationId,
      id(recordId),
      payload.companyId,
      payload.branchId,
      searchText(config, payload, resource),
      JSON.stringify(payload),
      contentHash(payload),
      context.userId,
      version,
    ],
  );
  const record = result.rows[0];
  if (!record) {
    throw new ProcurementError(409, "This document changed or is no longer editable. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  }
  await persistDocumentReferences(client, resource, record.id, references, payload);
  await replaceChildren(client, context, resource, record, payload);
  await event(client, context, record, resource, "updated", { version: record.version });
  await outbox(client, context, record, `procurement.${resource}.updated`, { recordId: record.id, version: record.version });
  return getProcurementRecord(client, context, resource, record.id);
}

const TRANSITIONS = Object.freeze({
  suppliers: {
    submit: ["draft", "submitted", "procurement.suppliers.manage"],
    qualify: ["submitted", "qualified", "procurement.suppliers.qualify"],
    activate: [["qualified", "suspended", "blocked"], "active", "procurement.suppliers.qualify"],
    block: [["active", "qualified", "suspended"], "blocked", "procurement.suppliers.qualify"],
    suspend: [["active", "qualified"], "suspended", "procurement.suppliers.qualify"],
    cancel: [["draft", "submitted"], "cancelled", "procurement.suppliers.manage"],
  },
  requisitions: {
    submit: [["draft", "rejected"], "submitted", "procurement.requisition.manage"],
    approve: [["submitted", "pending_approval"], "approved", "procurement.requisition.approve"],
    reject: [["submitted", "pending_approval"], "rejected", "procurement.requisition.approve"],
    close: ["approved", "closed", "procurement.requisition.manage"],
    cancel: [["draft", "submitted", "rejected"], "cancelled", "procurement.requisition.manage"],
  },
  "sourcing-events": {
    submit: ["draft", "submitted", "procurement.sourcing.manage"],
    approve: ["submitted", "approved", "procurement.sourcing.evaluate"],
    activate: ["approved", "active", "procurement.sourcing.manage"],
    close: ["active", "closed", "procurement.sourcing.manage"],
    cancel: [["draft", "submitted", "approved", "active"], "cancelled", "procurement.sourcing.manage"],
  },
  agreements: {
    submit: ["draft", "submitted", "procurement.contracts.manage"],
    approve: ["submitted", "approved", "procurement.contracts.approve"],
    activate: ["approved", "active", "procurement.contracts.manage"],
    close: ["active", "closed", "procurement.contracts.manage"],
    cancel: [["draft", "submitted", "approved"], "cancelled", "procurement.contracts.manage"],
  },
  "purchase-orders": {
    submit: [["draft", "rejected"], "submitted", "procurement.po.manage"],
    approve: [["submitted", "pending_approval"], "approved", "procurement.po.approve"],
    reject: [["submitted", "pending_approval"], "rejected", "procurement.po.approve"],
    dispatch: ["approved", "dispatched", "procurement.po.dispatch"],
    acknowledge: ["dispatched", "acknowledged", "procurement.po.manage"],
    close: [["received", "acknowledged", "partially_received"], "closed", "procurement.po.manage"],
    cancel: [["draft", "submitted", "approved", "dispatched"], "cancelled", "procurement.po.cancel"],
  },
  receipts: {
    submit: ["draft", "submitted", "procurement.receipts.manage"],
    approve: ["submitted", "approved", "procurement.receipts.approve"],
    reject: ["submitted", "rejected", "procurement.receipts.approve"],
    reverse: ["approved", "reversed", "procurement.receipts.approve"],
  },
  "service-entries": {
    submit: ["draft", "submitted", "procurement.receipts.manage"],
    approve: ["submitted", "approved", "procurement.receipts.approve"],
    reject: ["submitted", "rejected", "procurement.receipts.approve"],
    reverse: ["approved", "reversed", "procurement.receipts.approve"],
  },
  returns: {
    submit: ["draft", "submitted", "procurement.returns.manage"],
    approve: ["submitted", "approved", "procurement.receipts.approve"],
    dispatch: ["approved", "dispatched", "procurement.returns.manage"],
    close: ["dispatched", "closed", "procurement.returns.manage"],
    reject: ["submitted", "rejected", "procurement.receipts.approve"],
  },
  "match-exceptions": {
    resolve: ["open", "resolved", "procurement.matching.manage"],
    override: [["open", "resolved"], "overridden", "procurement.matching.override"],
    reopen: [["resolved", "overridden"], "open", "procurement.matching.manage"],
  },
});

function includesState(expected, current) {
  return Array.isArray(expected) ? expected.includes(current) : expected === current;
}

async function applyReceiptToOrder(client, context, receipt, direction = 1) {
  const payload = receipt.data || receipt;
  const purchaseOrderId = id(
    receipt.purchase_order_id || payload.purchaseOrderId,
    "Purchase order",
  );
  const orderResult = await client.query(
    `SELECT * FROM tenant.procurement_purchase_orders
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, purchaseOrderId],
  );
  const orderRow = orderResult.rows[0];
  if (!orderRow) {
    throw new ProcurementError(404, "Purchase order was not found.");
  }
  if (receipt.company_id && orderRow.company_id !== receipt.company_id) {
    throw new ProcurementError(409, "The receipt and purchase order belong to different companies.");
  }
  if (!["approved", "dispatched", "acknowledged", "partially_received", "received"].includes(orderRow.status)) {
    throw new ProcurementError(
      409,
      `A receipt cannot be applied to a ${orderRow.status} purchase order.`,
      "PROCUREMENT_REFERENCE_STATE",
    );
  }

  const order = await hydrateChildren(
    client,
    context,
    "purchase-orders",
    { ...(orderRow.data || {}), ...orderRow },
  );
  const receiptLines = payload.lines || [];
  const received = new Map(
    receiptLines.map((line) => [
      String(line.purchaseOrderLineId || line.id || line.itemId || line.description),
      decimal(line.acceptedQuantity ?? line.quantity ?? "0") * BigInt(direction),
    ]),
  );
  const lineRows = await client.query(
    `SELECT * FROM tenant.procurement_purchase_order_lines
      WHERE organization_id=$1 AND parent_id=$2
      ORDER BY created_at,id
      FOR UPDATE`,
    [context.organizationId, purchaseOrderId],
  );

  const lines = [];
  for (const row of lineRows.rows) {
    const line = { ...(row.data || {}), ...row };
    const key = String(line.id || line.itemId || line.description);
    const previous = decimal(
      row.received_quantity ?? line.receivedQuantity ?? "0",
    );
    const delta = received.get(key) || 0n;
    const next = previous + delta;
    const ordered = decimal(line.quantity ?? "0");
    if (next < 0n || next > ordered) {
      throw new ProcurementError(
        409,
        "Receipt quantity would exceed the remaining purchase-order quantity.",
        "PROCUREMENT_RECEIPT_QUANTITY",
      );
    }
    const nextLine = { ...(row.data || {}), receivedQuantity: format(next, 6) };
    await client.query(
      `UPDATE tenant.procurement_purchase_order_lines
          SET received_quantity=$3,
            data=$4::jsonb,
            content_hash=$5,
            version=version+1,
            updated_by=$6,
            updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$7`,
      [
        context.organizationId,
        row.id,
        format(next, 6),
        JSON.stringify(nextLine),
        contentHash(nextLine),
        context.userId,
        row.version || 1,
      ],
    );
    lines.push({ id: row.id, status: row.status, ...nextLine });
  }

  for (const key of received.keys()) {
    if (!lines.some((line) => String(line.id || line.itemId || line.description) === key)) {
      throw new ProcurementError(
        409,
        "A receipt line does not reference a line on this purchase order.",
        "PROCUREMENT_RECEIPT_LINE_INVALID",
      );
    }
  }

  const allReceived = lines.every(
    (line) => decimal(line.receivedQuantity) >= decimal(line.quantity),
  );
  const anyReceived = lines.some(
    (line) => decimal(line.receivedQuantity) > 0n,
  );
  const status = allReceived
    ? "received"
    : anyReceived
      ? "partially_received"
      : "acknowledged";
  const data = { ...(orderRow.data || {}), lines };
  const updated = await client.query(
    `
      UPDATE tenant.procurement_purchase_orders
      SET status=$3,data=$4::jsonb,content_hash=$5,version=version+1,
          updated_by=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND version=$7
      RETURNING *
    `,
    [
      context.organizationId,
      purchaseOrderId,
      status,
      JSON.stringify(data),
      contentHash(data),
      context.userId,
      orderRow.version,
    ],
  );
  if (!updated.rows[0]) {
    throw new ProcurementError(
      409,
      "The purchase order changed while the receipt was being posted.",
      "PROCUREMENT_VERSION_CONFLICT",
    );
  }
  const header = { ...(updated.rows[0].data || {}), ...updated.rows[0], lines };
  await event(
    client,
    context,
    header,
    "purchase-orders",
    direction > 0 ? "receipt-posted" : "receipt-reversed",
    { receiptId: receipt.id },
  );
  return header;
}

export async function transitionProcurementRecord(client, context, resource, recordId, action, input = {}) {
  if (action === "award" && resource === "sourcing-events") {
    return awardSourcingEvent(client, context, recordId, input);
  }
  if (action === "amend" && resource === "purchase-orders") {
    return amendPurchaseOrder(client, context, recordId, input);
  }
  if (action === "approve-amendment" && resource === "purchase-orders") {
    return approvePurchaseOrderAmendment(client, context, recordId, input);
  }
  if (action === "reject-amendment" && resource === "purchase-orders") {
    return rejectPurchaseOrderAmendment(client, context, recordId, input);
  }
  const transition = TRANSITIONS[resource]?.[action];
  if (!transition) {
    throw new ProcurementError(400, "Unsupported Procurement action.", "PROCUREMENT_ACTION_NOT_SUPPORTED");
  }
  permission(context, transition[2]);
  const current = await getProcurementRecord(client, context, resource, recordId);
  if (!includesState(transition[0], current.status)) {
    throw new ProcurementError(409, `Cannot ${action} a ${current.status} record.`, "PROCUREMENT_INVALID_TRANSITION");
  }
  const version = expectedVersion(input.expectedVersion);
  if (version !== Number(current.version)) {
    throw new ProcurementError(409, "This document changed after it was loaded. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  }
  if (["approve", "qualify"].includes(action) && current.created_by === context.userId) {
    throw new ProcurementError(409, "The creator cannot approve the same document.", "PROCUREMENT_SELF_APPROVAL");
  }
  if (["reject", "cancel", "block", "suspend", "override", "reverse"].includes(action)) {
    text(input.reason, "Reason", { required: true, max: 1000 });
  }
  const config = configFor(resource);
  const result = await client.query(
    `
      UPDATE tenant.${config.table}
      SET status=$3,version=version+1,updated_by=$4,updated_at=now(),
          data=jsonb_set(data,'{lastAction}',to_jsonb($5::text),true)
      WHERE organization_id=$1 AND id=$2 AND status=$6 AND version=$7
      RETURNING *
    `,
    [context.organizationId, id(recordId), transition[1], context.userId, action, current.status, version],
  );
  const record = result.rows[0];
  if (!record) throw new ProcurementError(409, "This document changed before the action was applied. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  if (resource === "receipts" && action === "approve") await applyReceiptToOrder(client, context, record, 1);
  if (resource === "receipts" && action === "reverse") await applyReceiptToOrder(client, context, record, -1);
  await event(client, context, record, resource, action, input);
  await outbox(client, context, record, `procurement.${resource}.${action}`, {
    recordId: record.id,
    status: transition[1],
    reason: input.reason || null,
  });
  return getProcurementRecord(client, context, resource, record.id);
}

export async function amendPurchaseOrder(client, context, recordId, input = {}) {
  permission(context, "procurement.po.amend");
  const orderId = id(recordId, "Purchase order");
  const locked = await client.query(
    `SELECT * FROM tenant.procurement_purchase_orders
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, orderId],
  );
  const currentRow = locked.rows[0];
  if (!currentRow) {
    throw new ProcurementError(404, "Purchase order was not found.");
  }
  ensureCompanyAccess(context, currentRow.company_id);
  const current = await hydrateChildren(
    client,
    context,
    "purchase-orders",
    { ...(currentRow.data || {}), ...currentRow },
  );
  const version = expectedVersion(input.expectedVersion);
  if (version !== Number(current.version)) {
    throw new ProcurementError(409, "This purchase order changed after it was loaded. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  }
  if (!["approved", "dispatched", "acknowledged", "partially_received"].includes(current.status)) {
    throw new ProcurementError(409, `Cannot amend a ${current.status} purchase order.`, "PROCUREMENT_INVALID_TRANSITION");
  }
  const reason = text(input.reason, "Amendment reason", { required: true, max: 1000 });
  const merged = normalizeDocument(
    "purchase-orders",
    { ...(current.data || current), ...input, companyId: current.company_id, branchId: current.branch_id },
    context,
  );
  const references = await validateDocumentReferences(
    client,
    context,
    "purchase-orders",
    merged,
  );
  await assertAgreementCapacity(client, context, "purchase-orders", merged, orderId);
  const amendment = {
    amendmentId: randomUUID(),
    requestedAt: new Date().toISOString(),
    requestedBy: context.userId,
    reason,
    previousStatus: current.status,
    previousVersion: current.version,
    previousHash: current.content_hash,
  };
  merged.amendments = [
    ...(Array.isArray(current.amendments) ? current.amendments : []),
    { ...amendment, status: "pending_approval" },
  ];
  merged.pendingAmendment = {
    ...amendment,
    previousData: current.data || {},
  };
  const result = await client.query(
    `UPDATE tenant.procurement_purchase_orders
        SET data=$3::jsonb,search_text=$4,content_hash=$5,version=version+1,
            status='pending_amendment_approval',updated_by=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND version=$7 AND status=$8
      RETURNING *`,
    [
      context.organizationId,
      orderId,
      JSON.stringify(merged),
      searchText(configFor("purchase-orders"), merged, "purchase-orders"),
      contentHash(merged),
      context.userId,
      version,
      current.status,
    ],
  );
  const record = result.rows[0];
  if (!record) throw new ProcurementError(409, "This purchase order changed before the amendment was submitted.", "PROCUREMENT_VERSION_CONFLICT");
  await persistDocumentReferences(client, "purchase-orders", record.id, references, merged);
  await replaceChildren(client, context, "purchase-orders", record, merged);
  await event(client, context, record, "purchase-orders", "amendment-submitted", amendment);
  await outbox(client, context, record, "procurement.purchase-orders.amendment-submitted", amendment);
  return getProcurementRecord(client, context, "purchase-orders", record.id);
}

async function decidePurchaseOrderAmendment(client, context, recordId, input, approved) {
  permission(context, "procurement.po.approve");
  const orderId = id(recordId, "Purchase order");
  const version = expectedVersion(input.expectedVersion);
  const locked = await client.query(
    `SELECT * FROM tenant.procurement_purchase_orders
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, orderId],
  );
  const row = locked.rows[0];
  if (!row) throw new ProcurementError(404, "Purchase order was not found.");
  ensureCompanyAccess(context, row.company_id);
  if (row.status !== "pending_amendment_approval") {
    throw new ProcurementError(409, "This purchase order amendment is not awaiting approval.", "PROCUREMENT_INVALID_TRANSITION");
  }
  if (version !== Number(row.version)) {
    throw new ProcurementError(409, "This purchase order amendment changed after it was loaded.", "PROCUREMENT_VERSION_CONFLICT");
  }
  const pending = row.data?.pendingAmendment;
  if (!pending || !["approved", "dispatched", "acknowledged", "partially_received"].includes(pending.previousStatus)) {
    throw new ProcurementError(409, "The purchase order amendment lineage is invalid.", "PROCUREMENT_AMENDMENT_LINEAGE");
  }
  // Segregation of duties: whoever requested the amendment cannot approve it.
  if (approved && pending.requestedBy && pending.requestedBy === context.userId) {
    throw new ProcurementError(409, "The person who requested the amendment cannot approve it.", "PROCUREMENT_SELF_APPROVAL");
  }
  const decisionReason = approved
    ? text(input.reason, "Approval note", { max: 1000 })
    : text(input.reason, "Rejection reason", { required: true, max: 1000 });
  const decision = {
    amendmentId: pending.amendmentId,
    decidedAt: new Date().toISOString(),
    decidedBy: context.userId,
    decision: approved ? "approved" : "rejected",
    reason: decisionReason || null,
  };
  let nextData;
  if (approved) {
    nextData = { ...(row.data || {}) };
    delete nextData.pendingAmendment;
    nextData.amendments = (Array.isArray(nextData.amendments) ? nextData.amendments : []).map((entry) =>
      entry?.amendmentId === pending.amendmentId
        ? { ...entry, status: "approved", approvedAt: decision.decidedAt, approvedBy: context.userId, approvalNote: decisionReason || null }
        : entry,
    );
  } else {
    nextData = { ...(pending.previousData || {}) };
    nextData.amendments = [
      ...(Array.isArray(nextData.amendments) ? nextData.amendments : []),
      {
        amendmentId: pending.amendmentId,
        requestedAt: pending.requestedAt,
        requestedBy: pending.requestedBy,
        reason: pending.reason,
        previousStatus: pending.previousStatus,
        previousVersion: pending.previousVersion,
        previousHash: pending.previousHash,
        status: "rejected",
        rejectedAt: decision.decidedAt,
        rejectedBy: context.userId,
        rejectionReason: decisionReason,
      },
    ];
  }
  const updated = await client.query(
    `UPDATE tenant.procurement_purchase_orders
        SET status=$3,data=$4::jsonb,search_text=$5,content_hash=$6,
            version=version+1,updated_by=$7,updated_at=now()
      WHERE organization_id=$1 AND id=$2
        AND status='pending_amendment_approval' AND version=$8
      RETURNING *`,
    [
      context.organizationId,
      orderId,
      pending.previousStatus,
      JSON.stringify(nextData),
      searchText(configFor("purchase-orders"), nextData, "purchase-orders"),
      contentHash(nextData),
      context.userId,
      version,
    ],
  );
  const record = updated.rows[0];
  if (!record) {
    throw new ProcurementError(409, "This purchase order amendment changed before the decision was applied.", "PROCUREMENT_VERSION_CONFLICT");
  }
  if (!approved) {
    const restored = normalizeDocument(
      "purchase-orders",
      { ...nextData, companyId: row.company_id, branchId: row.branch_id },
      context,
    );
    const references = await validateDocumentReferences(client, context, "purchase-orders", restored);
    await persistDocumentReferences(client, "purchase-orders", record.id, references, restored);
    await replaceChildren(client, context, "purchase-orders", record, restored);
  }
  await event(
    client,
    context,
    record,
    "purchase-orders",
    approved ? "amendment-approved" : "amendment-rejected",
    decision,
  );
  await outbox(
    client,
    context,
    record,
    approved
      ? "procurement.purchase-orders.amendment-approved"
      : "procurement.purchase-orders.amendment-rejected",
    decision,
  );
  return getProcurementRecord(client, context, "purchase-orders", record.id);
}

export async function approvePurchaseOrderAmendment(client, context, recordId, input = {}) {
  return decidePurchaseOrderAmendment(client, context, recordId, input, true);
}

export async function rejectPurchaseOrderAmendment(client, context, recordId, input = {}) {
  return decidePurchaseOrderAmendment(client, context, recordId, input, false);
}

export async function awardSourcingEvent(client, context, recordId, input = {}) {
  permission(context, "procurement.sourcing.award");
  const sourceId = id(recordId, "Sourcing event");
  const sourceRows = await client.query(
    `SELECT * FROM tenant.procurement_sourcing_events
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, sourceId],
  );
  const sourceRow = sourceRows.rows[0];
  if (!sourceRow) throw new ProcurementError(404, "Sourcing event was not found.");
  const version = expectedVersion(input.expectedVersion);
  if (version !== Number(sourceRow.version)) {
    throw new ProcurementError(
      409,
      "This sourcing event changed after it was loaded. Refresh and try again.",
      "PROCUREMENT_VERSION_CONFLICT",
    );
  }
  if (sourceRow.status !== "active") {
    throw new ProcurementError(
      409,
      `Cannot award a ${sourceRow.status} sourcing event.`,
      "PROCUREMENT_INVALID_TRANSITION",
    );
  }
  const existingAward = await client.query(
    `SELECT id,created_record_id,award_type
       FROM tenant.procurement_sourcing_awards
      WHERE organization_id=$1 AND source_event_id=$2`,
    [context.organizationId, sourceId],
  );
  if (existingAward.rows[0] || sourceRow.data?.award) {
    throw new ProcurementError(
      409,
      "This sourcing event has already been awarded.",
      "PROCUREMENT_AWARD_ALREADY_EXISTS",
    );
  }

  const source = await hydrateChildren(
    client,
    context,
    "sourcing-events",
    { ...(sourceRow.data || {}), ...sourceRow },
  );
  const selectedBidId = id(input.selectedBidId, "Selected bid");
  const bid = (source.bids || []).find((row) => String(row.id) === selectedBidId);
  if (!bid) {
    throw new ProcurementError(
      404,
      "Selected bid was not found in this sourcing event.",
    );
  }
  const supplierId = id(bid.supplierId || input.supplierId, "Supplier");
  await loadReference(
    client,
    context,
    "procurement_suppliers",
    supplierId,
    source.company_id,
    "Supplier",
    { allowedStatuses: ["qualified", "active"] },
  );
  const awardType = text(
    input.awardType || "purchase-order",
    "Award type",
    { required: true, max: 40 },
  );
  if (!new Set(["purchase-order", "agreement"]).has(awardType)) {
    throw new ProcurementError(
      400,
      "Award type must be purchase-order or agreement.",
    );
  }
  const lines = array(input.lines || bid.lines, "Award lines", { required: true });
  const idempotencyKey = `sourcing-award:${source.id}`;
  // The caller was just authorised to AWARD (procurement.sourcing.award). Creating
  // the PO/agreement is part of that one act, so it runs with the creation
  // permission it needs; without this, no seeded role (a purchase manager holds
  // award but not po.create; a buyer the reverse) could ever complete an award.
  const creator = {
    ...context,
    permissions: [...(context.permissions || []), "procurement.po.create", "procurement.contracts.manage"],
  };
  const created =
    awardType === "agreement"
      ? await createProcurementRecord(client, creator, "agreements", {
          companyId: source.company_id,
          branchId: source.branch_id,
          supplierId,
          title: input.title || `Award from ${source.eventNumber || source.title}`,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          currencyCode: input.currencyCode || bid.currencyCode || source.currencyCode,
          lines,
          sourceEventId: source.id,
          selectedBidId,
          idempotencyKey,
        })
      : await createProcurementRecord(client, creator, "purchase-orders", {
          companyId: source.company_id,
          branchId: source.branch_id,
          supplierId,
          title: input.title || `Award from ${source.eventNumber || source.title}`,
          expectedDeliveryDate: input.expectedDeliveryDate,
          currencyCode: input.currencyCode || bid.currencyCode || source.currencyCode,
          lines,
          sourceEventId: source.id,
          selectedBidId,
          idempotencyKey,
        });

  const award = {
    awardType,
    selectedBidId,
    supplierId,
    createdRecordId: created.id,
  };
  await client.query(
    `INSERT INTO tenant.procurement_sourcing_awards(
       organization_id,company_id,source_event_id,selected_bid_id,supplier_id,
       award_type,created_record_id,award_payload,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      context.organizationId,
      source.company_id,
      source.id,
      selectedBidId,
      supplierId,
      awardType,
      created.id,
      JSON.stringify(award),
      context.userId,
    ],
  );
  const updated = await client.query(
    `
      UPDATE tenant.procurement_sourcing_events
      SET status='closed',data=jsonb_set(data,'{award}',$3::jsonb,true),
          version=version+1,updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND version=$5 AND status='active'
      RETURNING *
    `,
    [context.organizationId, source.id, JSON.stringify(award), context.userId, version],
  );
  if (!updated.rows[0]) {
    throw new ProcurementError(
      409,
      "The sourcing event changed before the award was committed.",
      "PROCUREMENT_VERSION_CONFLICT",
    );
  }
  await event(client, context, updated.rows[0], "sourcing-events", "awarded", award);
  await outbox(client, context, updated.rows[0], "procurement.sourcing-events.awarded", award);
  return {
    sourceEvent: await getProcurementRecord(
      client,
      context,
      "sourcing-events",
      source.id,
    ),
    award: created,
  };
}

function lineKey(line) {
  return String(line.purchaseOrderLineId || line.id || line.itemId || line.description || "");
}

async function matchingTolerancePolicy(client, context, companyId) {
  const result = await client.query(
    `SELECT data FROM tenant.procurement_policies
      WHERE organization_id=$1 AND (company_id=$2 OR company_id IS NULL)
        AND status='active' AND data->>'policyType'='matching_tolerance'
      ORDER BY company_id IS NOT NULL DESC,updated_at DESC LIMIT 1`,
    [context.organizationId, companyId],
  );
  const configured = Number(result.rows[0]?.data?.tolerancePercent ?? 0);
  if (!Number.isFinite(configured) || configured < 0 || configured > 100) {
    throw new ProcurementError(409, "The configured Procurement matching tolerance is invalid.", "PROCUREMENT_MATCH_POLICY_INVALID");
  }
  return configured;
}

export async function runProcurementMatch(client, context, input) {
  permission(context, "procurement.matching.manage");
  const value = object(input);
  const purchaseOrderId = id(value.purchaseOrderId, "Purchase order");
  const purchaseOrderRows = await client.query(
    `SELECT * FROM tenant.procurement_purchase_orders
      WHERE organization_id=$1 AND id=$2
      FOR UPDATE`,
    [context.organizationId, purchaseOrderId],
  );
  const purchaseOrderRow = purchaseOrderRows.rows[0];
  if (!purchaseOrderRow) {
    throw new ProcurementError(404, "Purchase order was not found.");
  }
  if (!["approved", "dispatched", "acknowledged", "partially_received", "received"].includes(purchaseOrderRow.status)) {
    throw new ProcurementError(
      409,
      `A ${purchaseOrderRow.status} purchase order is not eligible for invoice matching.`,
      "PROCUREMENT_REFERENCE_STATE",
    );
  }
  const purchaseOrder = await hydrateChildren(
    client,
    context,
    "purchase-orders",
    { ...(purchaseOrderRow.data || {}), ...purchaseOrderRow },
  );
  const supplierId = id(
    value.supplierId || purchaseOrderRow.supplier_id || purchaseOrder.supplierId,
    "Supplier",
  );
  if (
    purchaseOrderRow.supplier_id &&
    purchaseOrderRow.supplier_id !== supplierId
  ) {
    throw new ProcurementError(
      409,
      "The invoice supplier does not match the purchase order supplier.",
      "PROCUREMENT_MATCH_SUPPLIER",
    );
  }
  const currencyCode = text(
    value.currencyCode || purchaseOrder.currencyCode || "INR",
    "Currency",
    { required: true, max: 3 },
  ).toUpperCase();
  if (
    purchaseOrder.currencyCode &&
    String(purchaseOrder.currencyCode).toUpperCase() !== currencyCode
  ) {
    throw new ProcurementError(
      409,
      "The invoice currency does not match the purchase order currency.",
      "PROCUREMENT_MATCH_CURRENCY",
    );
  }

  const invoiceNumber = text(value.invoiceNumber, "Invoice number", {
    required: true,
    max: 100,
  });
  const duplicate = await client.query(
    `SELECT id,status FROM tenant.procurement_invoice_matches
      WHERE organization_id=$1 AND company_id=$2 AND supplier_id=$3
        AND upper(invoice_number)=upper($4)
      FOR UPDATE`,
    [
      context.organizationId,
      purchaseOrder.company_id,
      supplierId,
      invoiceNumber,
    ],
  );
  if (duplicate.rows[0]) {
    throw new ProcurementError(
      409,
      "This supplier invoice number has already been matched.",
      "PROCUREMENT_DUPLICATE_INVOICE",
    );
  }

  const invoiceLines = array(value.invoiceLines, "Invoice lines", {
    required: true,
  }).map((line, index) => normalizeLine(line, index, "invoice"));
  const matchMode = text(value.matchMode || "three-way", "Match mode", {
    required: true,
    max: 20,
  });
  if (!new Set(["two-way", "three-way", "four-way"]).has(matchMode)) {
    throw new ProcurementError(
      400,
      "Match mode must be two-way, three-way or four-way.",
    );
  }

  const policyTolerancePercent = await matchingTolerancePolicy(
    client,
    context,
    purchaseOrder.company_id,
  );
  const requestedTolerancePercent =
    value.tolerancePercent == null
      ? policyTolerancePercent
      : Number(value.tolerancePercent);
  if (
    !Number.isFinite(requestedTolerancePercent) ||
    requestedTolerancePercent < 0 ||
    requestedTolerancePercent > 100
  ) {
    throw new ProcurementError(
      400,
      "Tolerance percent must be between 0 and 100.",
    );
  }
  const toleranceOverridden =
    requestedTolerancePercent !== policyTolerancePercent;
  if (toleranceOverridden) {
    permission(context, "procurement.matching.override");
    text(value.overrideReason, "Tolerance override reason", {
      required: true,
      max: 1000,
    });
  }
  const tolerancePercent = requestedTolerancePercent;

  const orderLineRows = await client.query(
    `SELECT * FROM tenant.procurement_purchase_order_lines
      WHERE organization_id=$1 AND parent_id=$2
      ORDER BY created_at,id
      FOR UPDATE`,
    [context.organizationId, purchaseOrderId],
  );
  const orderLines = orderLineRows.rows.map((row) => ({
    ...(row.data || {}),
    ...row,
  }));
  const issues = [];
  const quantityUpdates = [];
  let invoiceTotal = 0n;
  let orderMatchedTotal = 0n;

  for (const invoiceLine of invoiceLines) {
    const orderLine = orderLines.find(
      (line) => lineKey(line) === lineKey(invoiceLine),
    );
    const invoiceAmount = lineAmount(invoiceLine);
    invoiceTotal += invoiceAmount;
    if (!orderLine) {
      issues.push({
        type: "missing-order-line",
        line: invoiceLine.description,
        invoiceAmount: format(invoiceAmount, 2),
      });
      continue;
    }
    // Compare like with like: the PO line's value for the quantity being invoiced,
    // not for the whole line. Otherwise every partial invoice (4 of 10 units at the
    // agreed price) looked like a large "variance".
    const orderedForMatch = decimal(orderLine.quantity ?? "0");
    const invoicedForMatch = decimal(invoiceLine.quantity ?? "0");
    const orderAmount = orderedForMatch > 0n && invoicedForMatch > 0n
      ? (lineAmount(orderLine) * invoicedForMatch) / orderedForMatch
      : lineAmount(orderLine);
    orderMatchedTotal += orderAmount;
    const allowed =
      (orderAmount < 0n ? -orderAmount : orderAmount) *
      BigInt(Math.round(tolerancePercent * 100)) /
      10000n;
    const variance = invoiceAmount - orderAmount;
    if ((variance < 0n ? -variance : variance) > allowed) {
      issues.push({
        type: "price-or-value-variance",
        line: invoiceLine.description,
        variance: format(variance, 2),
        tolerancePercent,
      });
    }

    const alreadyInvoiced = decimal(
      orderLine.invoiced_quantity ?? orderLine.invoicedQuantity ?? "0",
    );
    const invoiceQuantity = decimal(invoiceLine.quantity ?? "0");
    const nextInvoiced = alreadyInvoiced + invoiceQuantity;
    const orderedQuantity = decimal(orderLine.quantity ?? "0");
    const receivedQuantity = decimal(
      orderLine.received_quantity ?? orderLine.receivedQuantity ?? "0",
    );
    const maximumQuantity =
      matchMode === "two-way" ? orderedQuantity : receivedQuantity;

    if (nextInvoiced > maximumQuantity) {
      issues.push({
        type:
          matchMode === "two-way"
            ? "order-quantity-variance"
            : "receipt-quantity-variance",
        line: invoiceLine.description,
        attemptedCumulativeQuantity: format(nextInvoiced, 6),
        eligibleQuantity: format(maximumQuantity, 6),
      });
    }
    if (matchMode === "four-way" && !orderLine.inspectionAccepted) {
      issues.push({
        type: "inspection-not-accepted",
        line: invoiceLine.description,
      });
    }
    quantityUpdates.push({
      row: orderLine,
      nextInvoiced,
    });
  }

  const varianceAmount = invoiceTotal - orderMatchedTotal;
  const status = issues.length ? "exception" : "matched";
  const matchingRecord = {
    purchaseOrderId,
    supplierId,
    companyId: purchaseOrder.company_id,
    branchId: purchaseOrder.branch_id || null,
    currencyCode,
    invoiceId: value.invoiceId ? id(value.invoiceId, "Invoice") : null,
    invoiceNumber,
    invoiceLines,
    sourceGoodsReceiptId: value.sourceGoodsReceiptId
      ? id(value.sourceGoodsReceiptId, "Goods receipt")
      : null,
    matchMode,
    tolerancePercent,
    policyTolerancePercent,
    toleranceOverridden,
    toleranceOverrideReason: toleranceOverridden
      ? text(value.overrideReason, "Tolerance override reason", { max: 1000 })
      : null,
    status,
    invoiceTotal: format(invoiceTotal, 2),
    orderMatchedTotal: format(orderMatchedTotal, 2),
    varianceAmount: format(varianceAmount, 2),
    issues,
    matchedAt: new Date().toISOString(),
    matchedBy: context.userId,
  };

  const ledger = await client.query(
    `INSERT INTO tenant.procurement_invoice_matches(
       organization_id,company_id,purchase_order_id,supplier_id,invoice_id,
       invoice_number,currency_code,match_mode,status,invoice_total,
       order_matched_total,variance_amount,payload,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
     RETURNING *`,
    [
      context.organizationId,
      purchaseOrder.company_id,
      purchaseOrderId,
      supplierId,
      matchingRecord.invoiceId,
      invoiceNumber,
      currencyCode,
      matchMode,
      status,
      format(invoiceTotal, 6),
      format(orderMatchedTotal, 6),
      format(varianceAmount, 6),
      JSON.stringify(matchingRecord),
      context.userId,
    ],
  );

  const matchResult = await client.query(
    `
      INSERT INTO tenant.procurement_matching_records(
        organization_id,company_id,parent_id,status,data,content_hash,updated_by
      ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
      RETURNING *
    `,
    [
      context.organizationId,
      purchaseOrder.company_id,
      purchaseOrder.id,
      status,
      JSON.stringify({
        ...matchingRecord,
        invoiceMatchId: ledger.rows[0].id,
      }),
      contentHash(matchingRecord),
      context.userId,
    ],
  );

  let exception = null;
  if (issues.length) {
    exception = await createProcurementRecord(
      client,
      context,
      "match-exceptions",
      {
        companyId: purchaseOrder.company_id,
        branchId: purchaseOrder.branch_id,
        purchaseOrderId,
        supplierId,
        invoiceNumber,
        title: `Match exception for ${invoiceNumber}`,
        varianceAmount: format(
          varianceAmount < 0n ? -varianceAmount : varianceAmount,
          2,
        ),
        issues,
        // Kept as details ON the exception. The child-table key ("matchingRecords")
        // would try to insert these as rows parented by the exception, but that
        // table's parent is the purchase order (the match record was already written
        // above), so every exception-producing match failed on the foreign key.
        matchDetails: [
          {
            matchingRecordId: matchResult.rows[0].id,
            invoiceMatchId: ledger.rows[0].id,
            ...matchingRecord,
          },
        ],
        idempotencyKey: `match-exception:${ledger.rows[0].id}`,
      },
    );
    await client.query(
      `UPDATE tenant.procurement_match_exceptions
          SET status='open'
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, exception.id],
    );
  } else {
    for (const update of quantityUpdates) {
      const nextData = {
        ...(update.row.data || {}),
        invoicedQuantity: format(update.nextInvoiced, 6),
      };
      const updated = await client.query(
        `UPDATE tenant.procurement_purchase_order_lines
            SET invoiced_quantity=$3,
              data=$4::jsonb,
              content_hash=$5,
              version=version+1,
              updated_by=$6,
              updated_at=now()
          WHERE organization_id=$1 AND id=$2 AND version=$7
          RETURNING id`,
        [
          context.organizationId,
          update.row.id,
          format(update.nextInvoiced, 6),
          JSON.stringify(nextData),
          contentHash(nextData),
          context.userId,
          update.row.version || 1,
        ],
      );
      if (!updated.rows[0]) {
        throw new ProcurementError(
          409,
          "A purchase-order line changed while the invoice was being matched.",
          "PROCUREMENT_VERSION_CONFLICT",
        );
      }
    }
    await outbox(
      client,
      context,
      purchaseOrder,
      "procurement.vendor-bill.ready",
      {
        ...matchingRecord,
        invoiceMatchId: ledger.rows[0].id,
      },
    );
  }

  await event(
    client,
    context,
    purchaseOrder,
    "purchase-orders",
    "invoice-matched",
    {
      ...matchingRecord,
      invoiceMatchId: ledger.rows[0].id,
    },
  );
  return {
    matchingRecord: {
      ...matchResult.rows[0],
      ...matchingRecord,
      invoiceMatchId: ledger.rows[0].id,
    },
    exception,
  };
}

export async function getProcurementDashboard(client, context) {
  permission(context, "procurement.view");
  const values = [context.organizationId];
  const companyFilter = companyWhere(context, values, "record");
  const result = await client.query(
    `
      SELECT
        (SELECT count(*) FROM tenant.procurement_requisitions record WHERE record.organization_id=$1 ${companyFilter} AND record.status IN ('submitted','pending_approval'))::int pending_requisitions,
        (SELECT count(*) FROM tenant.procurement_sourcing_events record WHERE record.organization_id=$1 ${companyFilter} AND record.status='active')::int active_sourcing,
        (SELECT count(*) FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 ${companyFilter} AND record.status IN ('approved','dispatched','acknowledged','partially_received','pending_amendment_approval'))::int open_orders,
        (SELECT count(*) FROM tenant.procurement_receipts record WHERE record.organization_id=$1 ${companyFilter} AND record.status IN ('draft','submitted'))::int pending_receipts,
        (SELECT count(*) FROM tenant.procurement_match_exceptions record WHERE record.organization_id=$1 ${companyFilter} AND record.status='open')::int match_exceptions,
        (SELECT count(*) FROM tenant.procurement_suppliers record WHERE record.organization_id=$1 ${companyFilter} AND record.status IN ('conditional','blocked','suspended'))::int supplier_risks,
        (SELECT coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 ${companyFilter} AND record.status NOT IN ('cancelled','closed'))::text open_commitment_value
    `,
    values,
  );
  return result.rows[0] || {};
}

const REPORT_SQL = Object.freeze({
  "spend-analysis": `SELECT coalesce(record.data->>'supplierId','unassigned') dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status NOT IN ('draft','cancelled') GROUP BY 1 ORDER BY coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) DESC`,
  "supplier-performance": `SELECT coalesce(supplier.data->>'supplierCode',supplier.data->>'displayName',scorecard.parent_id::text) dimension_value,count(*)::int scorecard_count,coalesce(avg(nullif(scorecard.data->>'overallScore','')::numeric),0)::text metric_value FROM tenant.procurement_supplier_scorecards scorecard LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id=scorecard.organization_id AND supplier.id=scorecard.parent_id WHERE scorecard.organization_id=$1 AND ($2::uuid IS NULL OR scorecard.company_id=$2) GROUP BY 1 ORDER BY coalesce(avg(nullif(scorecard.data->>'overallScore','')::numeric),0) DESC`,
  "purchase-price-variance": `SELECT coalesce(record.data->>'supplierId','unassigned') dimension_value,count(*)::int document_count,coalesce(sum(nullif(record.data->>'varianceAmount','')::numeric),0)::text metric_value FROM tenant.procurement_matching_records record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) GROUP BY 1 ORDER BY abs(coalesce(sum(nullif(record.data->>'varianceAmount','')::numeric),0)) DESC`,
  "contract-compliance": `SELECT CASE WHEN record.data ? 'agreementId' THEN 'on-contract' ELSE 'off-contract' END dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) GROUP BY 1 ORDER BY count(*) DESC`,
  "maverick-spend": `SELECT coalesce(record.data->>'requesterDepartment','unassigned') dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND NOT (record.data ? 'agreementId') GROUP BY 1 ORDER BY coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) DESC`,
  "open-commitments": `SELECT record.status dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status IN ('approved','dispatched','acknowledged','partially_received','pending_amendment_approval') GROUP BY record.status ORDER BY coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) DESC`,
  "overdue-orders": `SELECT coalesce(record.data->>'supplierId','unassigned') dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status NOT IN ('received','closed','cancelled') AND nullif(record.data->>'expectedDeliveryDate','')::date < current_date GROUP BY 1 ORDER BY count(*) DESC`,
  "matching-exceptions": `SELECT coalesce(record.data->'issues'->0->>'type','other') dimension_value,count(*)::int document_count,coalesce(sum(nullif(record.data->>'varianceAmount','')::numeric),0)::text metric_value FROM tenant.procurement_match_exceptions record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status='open' GROUP BY 1 ORDER BY count(*) DESC`,
  savings: `SELECT coalesce(record.data->'award'->>'supplierId','unassigned') dimension_value,count(*)::int document_count,coalesce(sum(nullif(record.data->>'savingsAmount','')::numeric),0)::text metric_value FROM tenant.procurement_sourcing_events record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status='closed' GROUP BY 1 ORDER BY coalesce(sum(nullif(record.data->>'savingsAmount','')::numeric),0) DESC`,
  "cycle-time": `SELECT record.entity_type dimension_value,count(*)::int document_count,coalesce(avg(extract(epoch FROM (record.updated_at-record.created_at))/86400),0)::text metric_value FROM tenant.procurement_events record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) GROUP BY record.entity_type ORDER BY coalesce(avg(extract(epoch FROM (record.updated_at-record.created_at))/86400),0) DESC`,
  "supplier-risk": `SELECT record.status dimension_value,count(*)::int document_count,count(*)::text metric_value FROM tenant.procurement_suppliers record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status IN ('conditional','blocked','suspended') GROUP BY record.status ORDER BY count(*) DESC`,
  "agreement-consumption": `SELECT coalesce(record.data->>'agreementId','unassigned') dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.data ? 'agreementId' GROUP BY 1 ORDER BY coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) DESC`,
});

export async function getProcurementReport(client, context, report, filters = {}) {
  permission(context, "procurement.reports.view");
  if (!REPORTS.has(report)) {
    throw new ProcurementError(404, "Unknown Procurement report.", "PROCUREMENT_REPORT_NOT_FOUND");
  }
  const companyId = context.allowAllCompanies ? null : context.activeCompanyId;
  if (!context.allowAllCompanies && !companyId) {
    return { report, filters, rows: [], materializedFacts: [] };
  }
  const live = await client.query(REPORT_SQL[report], [context.organizationId, companyId]);
  const facts = await client.query(
    `
      SELECT report_key,metric_key,metric_value,dimension_key,dimension_value
      FROM tenant.procurement_reporting_facts
      WHERE organization_id=$1 AND report_key=$2
        AND ($3::uuid IS NULL OR company_id=$3)
      ORDER BY metric_value DESC LIMIT 500
    `,
    [context.organizationId, report, companyId],
  );
  return { report, filters, rows: live.rows, materializedFacts: facts.rows };
}

export function evaluateSupplierScore(weights, scores) {
  const keys = Object.keys(weights);
  const allocations = allocate("100", keys.map((key) => weights[key]));
  let total = 0n;
  keys.forEach((key, index) => {
    total += (decimal(scores[key] || 0) * allocations[index]) / decimal("100");
  });
  return format(total, 2);
}

export { add, allocate, decimal, format, mul };
