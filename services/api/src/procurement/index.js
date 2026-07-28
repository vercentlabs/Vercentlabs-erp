import { createHash, randomUUID } from "node:crypto";

import { add, allocate, decimal, format, mul } from "./money.js";

export class ProcurementError extends Error {
  constructor(status, message, code = "PROCUREMENT_ERROR") {
    super(message);
    this.name = "ProcurementError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_STATES = new Set([
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "active",
  "dispatched",
  "acknowledged",
  "partially_received",
  "received",
  "closed",
  "cancelled",
  "blocked",
  "suspended",
  "qualified",
  "open",
  "resolved",
  "overridden",
  "reversed",
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
  const value = object(input);
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
  const value = object(input);
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
    status: text(value.status || "active", "Status", { required: true, max: 40 }),
  };
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

async function nextNumber(client, context, entityType, fallbackPrefix) {
  const result = await client.query(
    `
      UPDATE public.numbering_series
      SET next_number=next_number+1, updated_at=now()
      WHERE organization_id=$1 AND entity_type=$2 AND status='active'
      RETURNING prefix, next_number-1 AS number, padding
    `,
    [context.organizationId, entityType],
  );
  const row = result.rows[0];
  if (!row) return `${fallbackPrefix}${Date.now().toString().slice(-9)}`;
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 6), "0")}`;
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
  return { ...payload, [rule[2]]: await nextNumber(client, context, rule[0], rule[1]) };
}

async function insertChildren(client, context, resource, record, payload) {
  for (const [inputKey, table] of CHILDREN[resource] || []) {
    const entries = Array.isArray(payload[inputKey]) ? payload[inputKey] : [];
    for (const entry of entries) {
      const child = object(entry, inputKey);
      await client.query(
        `
          INSERT INTO tenant.${table}(
            organization_id,company_id,parent_id,status,data,created_at,updated_at
          ) VALUES($1,$2,$3,$4,$5::jsonb,now(),now())
        `,
        [
          context.organizationId,
          record.company_id,
          record.id,
          text(child.status || "active", "Child status", { required: true, max: 40 }),
          JSON.stringify(child),
        ],
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
        SELECT id,status,data,created_at,updated_at
        FROM tenant.${table}
        WHERE organization_id=$1 AND parent_id=$2
        ORDER BY created_at,id
      `,
      [context.organizationId, record.id],
    );
    hydrated[inputKey] = result.rows.map((row) => ({
      id: row.id,
      status: row.status,
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
    rows: rows.rows.map((row) => ({ ...(row.data || {}), ...row })),
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
  const row = { ...(result.rows[0].data || {}), ...result.rows[0] };
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

  if (config.kind === "child") {
    const payload = normalizeChild(resource, input, context);
    const result = await client.query(
      `
        INSERT INTO tenant.${config.table}(
          organization_id,company_id,parent_id,status,data,created_at,updated_at
        ) VALUES($1,$2,$3,$4,$5::jsonb,now(),now())
        RETURNING *
      `,
      [
        context.organizationId,
        payload.companyId,
        payload.parentId,
        payload.status,
        JSON.stringify(payload),
      ],
    );
    const record = { ...(result.rows[0].data || {}), ...result.rows[0] };
    await event(client, context, record, resource, "created", { contentHash: contentHash(payload) });
    return record;
  }

  let payload = normalizeDocument(resource, input, context);
  payload = await ensureNumber(client, context, resource, payload);
  const status = text(input.status || "draft", "Status", { required: true, max: 40 });
  if (!DOCUMENT_STATES.has(status)) {
    throw new ProcurementError(400, "Unsupported Procurement status.");
  }
  const idempotencyKey = text(input.idempotencyKey, "Idempotency key", { max: 200 });
  if (idempotencyKey) {
    const existing = await client.query(
      `SELECT * FROM tenant.${config.table} WHERE organization_id=$1 AND data->>'idempotencyKey'=$2 LIMIT 1`,
      [context.organizationId, idempotencyKey],
    );
    if (existing.rows[0]) return hydrateChildren(client, context, resource, { ...(existing.rows[0].data || {}), ...existing.rows[0] });
  }
  const result = await client.query(
    `
      INSERT INTO tenant.${config.table}(
        organization_id,company_id,branch_id,status,search_text,data,content_hash,
        created_by,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8)
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
    ],
  );
  const record = result.rows[0];
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
  const current = await getProcurementRecord(client, context, resource, recordId);
  if (config.kind === "child") {
    const payload = normalizeChild(resource, { ...(current.data || {}), ...input }, context);
    const result = await client.query(
      `
        UPDATE tenant.${config.table}
        SET status=$3,data=$4::jsonb,updated_at=now()
        WHERE organization_id=$1 AND id=$2
        RETURNING *
      `,
      [context.organizationId, id(recordId), payload.status, JSON.stringify(payload)],
    );
    return { ...(result.rows[0].data || {}), ...result.rows[0] };
  }
  if (!["draft", "rejected"].includes(current.status) && !input.allowLifecycleEdit) {
    throw new ProcurementError(409, "Only draft or rejected documents can be edited. Use a lifecycle action for approved records.", "PROCUREMENT_EDIT_LOCKED");
  }
  if (input.expectedVersion && Number(input.expectedVersion) !== Number(current.version)) {
    throw new ProcurementError(409, "This document changed after it was loaded. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  }
  let payload = normalizeDocument(resource, { ...(current.data || {}), ...input, companyId: current.company_id, branchId: current.branch_id }, context);
  payload = await ensureNumber(client, context, resource, payload);
  const result = await client.query(
    `
      UPDATE tenant.${config.table}
      SET company_id=$3,branch_id=$4,search_text=$5,data=$6::jsonb,content_hash=$7,
          version=version+1,updated_by=$8,updated_at=now()
      WHERE organization_id=$1 AND id=$2
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
    ],
  );
  const record = result.rows[0];
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
    submit: ["draft", "submitted", "procurement.requisition.manage"],
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
    submit: ["draft", "submitted", "procurement.po.manage"],
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
  const purchaseOrderId = id(payload.purchaseOrderId, "Purchase order");
  const order = await getProcurementRecord(client, context, "purchase-orders", purchaseOrderId);
  const received = new Map(
    (payload.lines || []).map((line) => [
      String(line.purchaseOrderLineId || line.id || line.itemId || line.description),
      decimal(line.acceptedQuantity ?? line.quantity ?? "0") * BigInt(direction),
    ]),
  );
  const lines = (order.lines || []).map((line) => {
    const key = String(line.id || line.itemId || line.description);
    const previous = decimal(line.receivedQuantity ?? "0");
    const next = previous + (received.get(key) || 0n);
    const ordered = decimal(line.quantity ?? "0");
    if (next < 0n || next > ordered) {
      throw new ProcurementError(409, "Receipt quantity would exceed the remaining purchase-order quantity.", "PROCUREMENT_RECEIPT_QUANTITY");
    }
    return { ...line, receivedQuantity: format(next, 6) };
  });
  const allReceived = lines.every((line) => decimal(line.receivedQuantity) >= decimal(line.quantity));
  const anyReceived = lines.some((line) => decimal(line.receivedQuantity) > 0n);
  const status = allReceived ? "received" : anyReceived ? "partially_received" : "acknowledged";
  const data = { ...(order.data || order), lines };
  await client.query(
    `
      UPDATE tenant.procurement_purchase_orders
      SET status=$3,data=$4::jsonb,content_hash=$5,version=version+1,
          updated_by=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2
    `,
    [context.organizationId, purchaseOrderId, status, JSON.stringify(data), contentHash(data), context.userId],
  );
  const header = { ...order, status, data, version: Number(order.version || 1) + 1 };
  await replaceChildren(client, context, "purchase-orders", header, data);
  await event(client, context, header, "purchase-orders", direction > 0 ? "receipt-posted" : "receipt-reversed", { receiptId: receipt.id });
  return header;
}

export async function transitionProcurementRecord(client, context, resource, recordId, action, input = {}) {
  if (action === "award" && resource === "sourcing-events") {
    return awardSourcingEvent(client, context, recordId, input);
  }
  if (action === "amend" && resource === "purchase-orders") {
    return amendPurchaseOrder(client, context, recordId, input);
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
  if (input.expectedVersion && Number(input.expectedVersion) !== Number(current.version)) {
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
      WHERE organization_id=$1 AND id=$2
      RETURNING *
    `,
    [context.organizationId, id(recordId), transition[1], context.userId, action],
  );
  const record = result.rows[0];
  if (!record) throw new ProcurementError(404, "Procurement record not found.");
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
  const current = await getProcurementRecord(client, context, "purchase-orders", recordId);
  if (!["approved", "dispatched", "acknowledged", "partially_received"].includes(current.status)) {
    throw new ProcurementError(409, `Cannot amend a ${current.status} purchase order.`, "PROCUREMENT_INVALID_TRANSITION");
  }
  const reason = text(input.reason, "Amendment reason", { required: true, max: 1000 });
  const merged = normalizeDocument(
    "purchase-orders",
    { ...(current.data || current), ...input, companyId: current.company_id, branchId: current.branch_id },
    context,
  );
  const amendment = {
    amendmentId: randomUUID(),
    amendedAt: new Date().toISOString(),
    amendedBy: context.userId,
    reason,
    previousVersion: current.version,
    previousHash: current.content_hash,
    previousData: current.data || {},
  };
  merged.amendments = [...(Array.isArray(current.amendments) ? current.amendments : []), amendment];
  const result = await client.query(
    `
      UPDATE tenant.procurement_purchase_orders
      SET data=$3::jsonb,search_text=$4,content_hash=$5,version=version+1,
          status='approved',updated_by=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *
    `,
    [
      context.organizationId,
      id(recordId),
      JSON.stringify(merged),
      searchText(configFor("purchase-orders"), merged, "purchase-orders"),
      contentHash(merged),
      context.userId,
    ],
  );
  const record = result.rows[0];
  await replaceChildren(client, context, "purchase-orders", record, merged);
  await event(client, context, record, "purchase-orders", "amended", amendment);
  await outbox(client, context, record, "procurement.purchase-orders.amended", amendment);
  return getProcurementRecord(client, context, "purchase-orders", record.id);
}

export async function awardSourcingEvent(client, context, recordId, input = {}) {
  permission(context, "procurement.sourcing.award");
  const source = await getProcurementRecord(client, context, "sourcing-events", recordId);
  if (!["active", "closed"].includes(source.status)) {
    throw new ProcurementError(409, `Cannot award a ${source.status} sourcing event.`, "PROCUREMENT_INVALID_TRANSITION");
  }
  const selectedBidId = id(input.selectedBidId, "Selected bid");
  const bid = (source.bids || []).find((row) => String(row.id) === selectedBidId);
  if (!bid) throw new ProcurementError(404, "Selected bid was not found in this sourcing event.");
  const supplierId = id(bid.supplierId || input.supplierId, "Supplier");
  const awardType = text(input.awardType || "purchase-order", "Award type", { required: true, max: 40 });
  if (!new Set(["purchase-order", "agreement"]).has(awardType)) {
    throw new ProcurementError(400, "Award type must be purchase-order or agreement.");
  }
  const lines = array(input.lines || bid.lines, "Award lines", { required: true });
  const created = awardType === "agreement"
    ? await createProcurementRecord(client, context, "agreements", {
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
      })
    : await createProcurementRecord(client, context, "purchase-orders", {
        companyId: source.company_id,
        branchId: source.branch_id,
        supplierId,
        title: input.title || `Award from ${source.eventNumber || source.title}`,
        expectedDeliveryDate: input.expectedDeliveryDate,
        currencyCode: input.currencyCode || bid.currencyCode || source.currencyCode,
        lines,
        sourceEventId: source.id,
        selectedBidId,
      });
  const award = { awardType, selectedBidId, supplierId, createdRecordId: created.id };
  await client.query(
    `
      UPDATE tenant.procurement_sourcing_events
      SET status='closed',data=jsonb_set(data,'{award}',$3::jsonb,true),
          version=version+1,updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2
    `,
    [context.organizationId, source.id, JSON.stringify(award), context.userId],
  );
  await event(client, context, source, "sourcing-events", "awarded", award);
  await outbox(client, context, source, "procurement.sourcing-events.awarded", award);
  return { sourceEvent: await getProcurementRecord(client, context, "sourcing-events", source.id), award: created };
}

function lineKey(line) {
  return String(line.purchaseOrderLineId || line.id || line.itemId || line.description || "");
}

export async function runProcurementMatch(client, context, input) {
  permission(context, "procurement.matching.manage");
  const value = object(input);
  const purchaseOrderId = id(value.purchaseOrderId, "Purchase order");
  const purchaseOrder = await getProcurementRecord(client, context, "purchase-orders", purchaseOrderId);
  const invoiceNumber = text(value.invoiceNumber, "Invoice number", { required: true, max: 100 });
  const invoiceLines = array(value.invoiceLines, "Invoice lines", { required: true }).map((line, index) => normalizeLine(line, index, "invoice"));
  const matchMode = text(value.matchMode || "three-way", "Match mode", { required: true, max: 20 });
  if (!new Set(["two-way", "three-way", "four-way"]).has(matchMode)) {
    throw new ProcurementError(400, "Match mode must be two-way, three-way or four-way.");
  }
  const tolerancePercent = Number(value.tolerancePercent ?? 0);
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
    throw new ProcurementError(400, "Tolerance percent must be between 0 and 100.");
  }
  const orderLines = purchaseOrder.lines || [];
  const issues = [];
  let invoiceTotal = 0n;
  let orderMatchedTotal = 0n;
  for (const invoiceLine of invoiceLines) {
    const orderLine = orderLines.find((line) => lineKey(line) === lineKey(invoiceLine));
    const invoiceAmount = lineAmount(invoiceLine);
    invoiceTotal += invoiceAmount;
    if (!orderLine) {
      issues.push({ type: "missing-order-line", line: invoiceLine.description, invoiceAmount: format(invoiceAmount, 2) });
      continue;
    }
    const orderAmount = lineAmount(orderLine);
    orderMatchedTotal += orderAmount;
    const allowed = (orderAmount < 0n ? -orderAmount : orderAmount) * BigInt(Math.round(tolerancePercent * 100)) / 10000n;
    const variance = invoiceAmount - orderAmount;
    if ((variance < 0n ? -variance : variance) > allowed) {
      issues.push({ type: "price-or-value-variance", line: invoiceLine.description, variance: format(variance, 2), tolerancePercent });
    }
    if (matchMode !== "two-way") {
      const received = decimal(orderLine.receivedQuantity ?? "0");
      const invoiced = decimal(invoiceLine.quantity ?? "0");
      if (invoiced > received) {
        issues.push({ type: "receipt-quantity-variance", line: invoiceLine.description, invoicedQuantity: format(invoiced, 6), receivedQuantity: format(received, 6) });
      }
    }
    if (matchMode === "four-way" && !orderLine.inspectionAccepted) {
      issues.push({ type: "inspection-not-accepted", line: invoiceLine.description });
    }
  }
  const varianceAmount = invoiceTotal - orderMatchedTotal;
  const status = issues.length ? "exception" : "matched";
  const matchingRecord = {
    purchaseOrderId,
    supplierId: purchaseOrder.supplierId || null,
    companyId: purchaseOrder.company_id,
    branchId: purchaseOrder.branch_id || null,
    currencyCode: purchaseOrder.currencyCode || "INR",
    invoiceId: value.invoiceId ? id(value.invoiceId, "Invoice") : null,
    invoiceNumber,
    invoiceLines,
    sourceGoodsReceiptId: value.sourceGoodsReceiptId
      ? id(value.sourceGoodsReceiptId, "Goods receipt")
      : null,
    matchMode,
    tolerancePercent,
    status,
    invoiceTotal: format(invoiceTotal, 2),
    orderMatchedTotal: format(orderMatchedTotal, 2),
    varianceAmount: format(varianceAmount, 2),
    issues,
    matchedAt: new Date().toISOString(),
    matchedBy: context.userId,
  };
  const matchResult = await client.query(
    `
      INSERT INTO tenant.procurement_matching_records(
        organization_id,company_id,parent_id,status,data
      ) VALUES($1,$2,$3,$4,$5::jsonb)
      RETURNING *
    `,
    [context.organizationId, purchaseOrder.company_id, purchaseOrder.id, status, JSON.stringify(matchingRecord)],
  );
  let exception = null;
  if (issues.length) {
    exception = await createProcurementRecord(client, context, "match-exceptions", {
      companyId: purchaseOrder.company_id,
      branchId: purchaseOrder.branch_id,
      purchaseOrderId,
      invoiceNumber,
      title: `Match exception for ${invoiceNumber}`,
      varianceAmount: format(varianceAmount < 0n ? -varianceAmount : varianceAmount, 2),
      issues,
      matchingRecords: [{ matchingRecordId: matchResult.rows[0].id, ...matchingRecord }],
      status: "open",
    });
    await client.query(
      `UPDATE tenant.procurement_match_exceptions SET status='open' WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, exception.id],
    );
  } else {
    await outbox(client, context, purchaseOrder, "procurement.vendor-bill.ready", matchingRecord);
  }
  await event(client, context, purchaseOrder, "purchase-orders", "invoice-matched", matchingRecord);
  return { matchingRecord: { ...matchResult.rows[0], ...matchingRecord }, exception };
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
        (SELECT count(*) FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 ${companyFilter} AND record.status IN ('approved','dispatched','acknowledged','partially_received'))::int open_orders,
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
  "open-commitments": `SELECT record.status dimension_value,count(*)::int document_count,coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0)::text metric_value FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 AND ($2::uuid IS NULL OR record.company_id=$2) AND record.status IN ('approved','dispatched','acknowledged','partially_received') GROUP BY record.status ORDER BY coalesce(sum((record.data->'totals'->>'grandTotal')::numeric),0) DESC`,
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
